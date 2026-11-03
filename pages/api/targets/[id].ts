import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string;

  if (req.method === "GET") {
    const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(id);
    if (!target) return res.status(404).json({ error: "Not found" });

    const company = db.prepare("SELECT * FROM companies WHERE id = (SELECT company_id FROM targets WHERE id = ?)").get(id);
    const lists = db.prepare(`
      SELECT l.id, l.name FROM lists l
      INNER JOIN list_targets lt ON lt.list_id = l.id
      WHERE lt.target_id = ?
      ORDER BY l.name COLLATE NOCASE
    `).all(id);

    return res.json({ ...target as object, company: company ?? null, lists });
  }

  if (req.method === "PATCH") {
    const target = db.prepare("SELECT id FROM targets WHERE id = ?").get(id);
    if (!target) return res.status(404).json({ error: "Not found" });

    // Editable contact fields (CRM hygiene). Anything else is owned by enrichment/automation.
    const EDITABLE = [
      "first_name", "last_name", "full_name", "title", "company", "location",
      "salutation", "email", "phone", "headline", "summary", "notes", "timezone",
      "linkedin_url", "sales_nav_url", "seniority", "email_status", "company_industry", "company_location",
    ] as const;

    const body = req.body as Record<string, unknown>;
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const col of EDITABLE) {
      if (body[col] !== undefined) {
        const v = body[col];
        fields.push(`${col} = ?`);
        params.push(typeof v === "string" ? (v.trim() || null) : v);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: "No editable fields provided" });
    params.push(id);
    try {
      db.prepare(`UPDATE targets SET ${fields.join(", ")} WHERE id = ?`).run(...params);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("UNIQUE")) {
        return res.status(409).json({ error: "A contact with this LinkedIn URL already exists" });
      }
      throw e;
    }

    return res.json(db.prepare("SELECT * FROM targets WHERE id = ?").get(id));
  }

  if (req.method === "DELETE") {
    const target = db.prepare("SELECT id FROM targets WHERE id = ?").get(id);
    if (!target) return res.status(404).json({ error: "Not found" });
    // Some references (run_profiles, logs) have no ON DELETE CASCADE — clear them first so the
    // FK constraint doesn't block the delete. run_profile_tracks cascade off run_profiles.
    db.transaction(() => {
      db.prepare("DELETE FROM run_profiles WHERE target_id = ?").run(id);
      db.prepare("DELETE FROM logs WHERE target_id = ?").run(id);
      db.prepare("DELETE FROM targets WHERE id = ?").run(id);
    })();
    return res.json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
  return res.status(405).end();
}
