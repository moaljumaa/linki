import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getDailyImportCap, setDailyImportCap, DEFAULT_DAILY_CAP } from "@/lib/import-jobs";

/** GET → { cap }, PUT { cap } → set the global daily import cap. */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    return res.json({ cap: getDailyImportCap(db), default: DEFAULT_DAILY_CAP });
  }

  if (req.method === "PUT") {
    const { cap } = req.body as { cap?: number };
    const n = Number(cap);
    if (!Number.isFinite(n) || n < 1) return res.status(400).json({ error: "cap must be a positive number" });
    setDailyImportCap(db, n);
    return res.json({ cap: getDailyImportCap(db) });
  }

  res.setHeader("Allow", ["GET", "PUT"]);
  return res.status(405).end();
}
