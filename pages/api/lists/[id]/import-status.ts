import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getDailyImportCap } from "@/lib/import-jobs";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = req.query.id as string;
  const dailyCap = getDailyImportCap(db);

  // All batches for this list, newest first
  const batches = db.prepare(`
    SELECT id, status, phase, page, total_pages, count, total, imported, skipped, error,
           scheduled_for, start_page, batch_index, started_at, finished_at
    FROM list_imports
    WHERE list_id = ?
    ORDER BY batch_index ASC, started_at DESC
  `).all(listId) as Array<{
    id: string; status: string; phase: string | null; page: number; total_pages: number;
    count: number; total: number; imported: number; skipped: number; error: string | null;
    scheduled_for: string | null; start_page: number; batch_index: number;
    started_at: string; finished_at: string | null;
  }>;

  if (batches.length === 0) return res.json({ status: "idle", dailyCap });

  // The "current" batch = running > scheduled > most recent — drives the old single-job UI
  const current =
    batches.find((b) => b.status === "running") ??
    batches.find((b) => b.status === "scheduled") ??
    batches[batches.length - 1];

  const total = batches.reduce((m, b) => Math.max(m, b.total || 0), 0);
  const importedSoFar = batches.reduce((s, b) => s + (b.imported || 0), 0);
  const remaining = total > 0 ? Math.max(0, total - importedSoFar) : 0;

  return res.json({
    ...current,
    dailyCap,
    batches,
    // Plan summary: is this list being split across days?
    plan: { total, importedSoFar, remaining, exceedsCap: total > dailyCap, dailyCap },
  });
}
