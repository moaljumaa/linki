import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

// Per-page product tour "seen" flags, stored as app_settings rows (tour_seen_<page>).
// Single-user tool — no per-account state needed, so a global key/value flag is enough.
const KEY_PREFIX = "tour_seen_";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    const rows = db.prepare("SELECT key FROM app_settings WHERE key LIKE ?").all(`${KEY_PREFIX}%`) as { key: string }[];
    const seen = rows.map((r) => r.key.slice(KEY_PREFIX.length));
    return res.json({ seen });
  }

  if (req.method === "POST") {
    const { page } = req.body as { page?: string };
    if (!page) return res.status(400).json({ error: "page is required" });
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, '1', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now')`
    ).run(`${KEY_PREFIX}${page}`);
    return res.json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
