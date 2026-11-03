import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

// Remove contacts from a list (membership only — never deletes the contact). Filters are OR'd:
// titles (exact), title_patterns (LIKE %p%), exclude_location_substrings (LIKE %l%). dry_run previews.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const list_id = req.query.id as string;

  const list = db.prepare("SELECT id FROM lists WHERE id = ?").get(list_id);
  if (!list) return res.status(404).json({ error: "List not found" });

  const { contact_ids, titles, title_patterns, exclude_location_substrings, dry_run = true } = req.body as {
    contact_ids?: string[];
    titles?: string[];
    title_patterns?: string[];
    exclude_location_substrings?: string[];
    dry_run?: boolean;
  };

  const conditions: string[] = [];
  const params: unknown[] = [list_id];

  // Precise, ID-scoped removal — safest path (no title collisions). When
  // contact_ids is given it is OR'd in like any other filter, so a curated set
  // (built manually or by an LLM pass) removes exactly those contacts.
  if (contact_ids && contact_ids.length > 0) {
    const placeholders = contact_ids.map(() => "?").join(", ");
    conditions.push(`t.id IN (${placeholders})`);
    params.push(...contact_ids);
  }
  if (titles && titles.length > 0) {
    const placeholders = titles.map(() => "?").join(", ");
    conditions.push(`t.title IN (${placeholders})`);
    params.push(...titles);
  }
  if (title_patterns && title_patterns.length > 0) {
    const patternClauses = title_patterns.map(() => "t.title LIKE ?").join(" OR ");
    conditions.push(`(${patternClauses})`);
    for (const p of title_patterns) params.push(`%${p}%`);
  }
  if (exclude_location_substrings && exclude_location_substrings.length > 0) {
    const locClauses = exclude_location_substrings.map(() => "t.location LIKE ?").join(" OR ");
    conditions.push(`(${locClauses})`);
    for (const l of exclude_location_substrings) params.push(`%${l}%`);
  }

  if (conditions.length === 0) {
    return res.status(400).json({ error: "No filters provided — nothing to remove." });
  }

  const whereFilter = conditions.join(" OR ");

  const preview = db.prepare(`
    SELECT t.id, t.full_name, t.title, t.location
    FROM list_targets lt
    JOIN targets t ON t.id = lt.target_id
    WHERE lt.list_id = ? AND (${whereFilter})
    ORDER BY t.title
  `).all(...params);

  if (dry_run) {
    return res.json({ dry_run: true, would_remove: preview.length, contacts: preview });
  }

  db.prepare(`
    DELETE FROM list_targets
    WHERE list_id = ?
      AND target_id IN (
        SELECT t.id FROM list_targets lt
        JOIN targets t ON t.id = lt.target_id
        WHERE lt.list_id = ? AND (${whereFilter})
      )
  `).run(list_id, list_id, ...params.slice(1));

  const remaining = (db.prepare("SELECT COUNT(*) as c FROM list_targets WHERE list_id = ?").get(list_id) as { c: number }).c;

  // Surface the exact removed IDs so a removal is trivially reversible:
  // feed removed_contact_ids straight into add_to_list to undo this batch.
  const removedIds = (preview as Array<{ id: string }>).map((c) => c.id);

  return res.json({
    dry_run: false,
    removed: preview.length,
    remaining,
    contacts_removed: preview,
    removed_contact_ids: removedIds,
    undo_hint: "To undo, call add_to_list with these removed_contact_ids.",
  });
}
