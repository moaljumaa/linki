import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    // Paging + light default fields — the full enrichment blobs (description, keywords,
    // technology_names, etc.) are heavy; only return them when full=1 is requested.
    const full = req.query.full === "1" || req.query.full === "true";
    const search = (req.query.search as string | undefined)?.trim();
    // Page by default (trimmed fields). full=1 with no explicit limit returns the whole set
    // (the companies UI relies on this for its own client-side search/filter).
    const explicitPaging = req.query.limit !== undefined || req.query.page !== undefined;
    const hasPaging = explicitPaging || !full;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = (Number(req.query.page) || 0) * limit;

    const where = search ? "WHERE c.name LIKE ?" : "";
    const whereArgs: unknown[] = search ? [`%${search}%`] : [];

    const select = full
      ? "c.*"
      : "c.id, c.name, c.domain, c.industry, c.location, c.website, c.employee_count, c.created_at";

    const total = (db.prepare(`SELECT COUNT(*) as c FROM companies c ${where}`).get(...whereArgs) as { c: number }).c;

    const pageClause = hasPaging ? " LIMIT ? OFFSET ?" : "";
    const pageArgs = hasPaging ? [limit, offset] : [];

    const companies = db.prepare(`
      SELECT ${select}, COUNT(t.id) as contact_count
      FROM companies c
      LEFT JOIN targets t ON t.company_id = c.id
      ${where}
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE${pageClause}
    `).all(...whereArgs, ...pageArgs);

    return res.json({ companies, total });
  }

  if (req.method === "POST") {
    const { name, domain, industry, location, linkedin_url, website, notes } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const id = randomUUID();
    db.prepare(`
      INSERT INTO companies (id, name, domain, industry, location, linkedin_url, website, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, domain ?? null, industry ?? null, location ?? null, linkedin_url ?? null, website ?? null, notes ?? null);
    return res.status(201).json(db.prepare("SELECT * FROM companies WHERE id = ?").get(id));
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end();
}
