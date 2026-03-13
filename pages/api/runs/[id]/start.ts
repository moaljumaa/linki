import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const id = req.query.id as string;

  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
    | { status: string }
    | undefined;
  if (!run) return res.status(404).json({ error: "Run not found" });

  // Atomic guard: only transition to 'running' if currently NOT running
  const result = db.prepare(
    "UPDATE runs SET status = 'running', started_at = datetime('now') WHERE id = ? AND status != 'running'"
  ).run(id);
  if (result.changes === 0) return res.status(400).json({ error: "Run already running" });

  // Fire-and-forget: import and run the runner without awaiting
  setImmediate(async () => {
    try {
      const { startRun } = await import("@/lib/linkedin/runner");
      await startRun(id);
    } catch (err) {
      console.error(`Runner failed for run ${id}:`, err);
      db.prepare("UPDATE runs SET status = 'failed' WHERE id = ?").run(id);
    }
  });

  return res.json({ ok: true });
}
