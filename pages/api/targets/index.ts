import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import type { ActiveFilter, FilterOp } from "@/components/ui/FilterBar";

// Parse f[0][field], f[0][op], f[0][value], f[1][field], ... from query
function parseFilters(query: NextApiRequest["query"]): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  let i = 0;
  while (query[`f[${i}][field]`]) {
    const field = query[`f[${i}][field]`] as string;
    const op = query[`f[${i}][op]`] as FilterOp;
    const value = query[`f[${i}][value]`] as string | undefined;
    filters.push({ id: String(i), field, op, value });
    i++;
  }
  return filters;
}

function buildFilterClause(filters: ActiveFilter[]): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  for (const f of filters) {
    // connection_status is derived — map to real columns
    if (f.field === "connection_status") {
      let expr: string;
      switch (f.value) {
        case "replied":
          expr = "t.last_replied_at IS NOT NULL";
          break;
        case "messaged":
          expr = "t.message_sent_at IS NOT NULL AND t.last_replied_at IS NULL";
          break;
        case "connected":
          expr = "t.degree = 1 AND t.message_sent_at IS NULL";
          break;
        case "request_sent":
          expr = "t.connection_requested_at IS NOT NULL AND (t.degree IS NULL OR t.degree != 1)";
          break;
        case "not_contacted":
        default:
          expr = "t.connection_requested_at IS NULL AND t.message_sent_at IS NULL";
      }
      if (f.op === "is_not") expr = `NOT (${expr})`;
      parts.push(expr);
      continue;
    }

    // Safe-list of allowed columns
    const ALLOWED: Record<string, string> = {
      seniority: "t.seniority",
      email_status: "t.email_status",
      degree: "t.degree",
      email: "t.email",
      apollo_enriched_at: "t.apollo_enriched_at",
      connection_requested_at: "t.connection_requested_at",
      connected_at: "t.connected_at",
      message_sent_at: "t.message_sent_at",
      last_replied_at: "t.last_replied_at",
      open_link: "t.open_link",
      email_domain_catchall: "t.email_domain_catchall",
      company_size: "t.company_size",
      tenure_months: "t.tenure_months",
      country: "t.country",
      company_industry: "t.company_industry",
      company: "t.company",
    };

    const col = ALLOWED[f.field];
    if (!col) continue;

    switch (f.op) {
      case "is_set":
        parts.push(`${col} IS NOT NULL AND ${col} != ''`);
        break;
      case "is_not_set":
        parts.push(`(${col} IS NULL OR ${col} = '')`);
        break;
      case "is_true":
        parts.push(`${col} = 1`);
        break;
      case "is_false":
        parts.push(`(${col} = 0 OR ${col} IS NULL)`);
        break;
      case "is":
        parts.push(`LOWER(${col}) = LOWER(?)`);
        params.push(f.value ?? "");
        break;
      case "is_not":
        parts.push(`LOWER(${col}) != LOWER(?)`);
        params.push(f.value ?? "");
        break;
      case "contains":
        parts.push(`${col} LIKE ?`);
        params.push(`%${f.value ?? ""}%`);
        break;
      case "gt":
        parts.push(`CAST(${col} AS REAL) > ?`);
        params.push(Number(f.value ?? 0));
        break;
      case "lt":
        parts.push(`CAST(${col} AS REAL) < ?`);
        params.push(Number(f.value ?? 0));
        break;
    }
  }

  return {
    sql: parts.length > 0 ? " AND " + parts.join(" AND ") : "",
    params,
  };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    const db = getDb();
    const { full_name, linkedin_url, title, company, location, email, phone, list_id } = req.body;
    if (!full_name || !linkedin_url) {
      return res.status(400).json({ error: "full_name and linkedin_url are required" });
    }
    const id = randomUUID();
    try {
      db.prepare(
        `INSERT INTO targets (id, full_name, linkedin_url, title, company, location, email, phone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, full_name, linkedin_url, title ?? null, company ?? null, location ?? null, email ?? null, phone ?? null);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("UNIQUE")) {
        return res.status(409).json({ error: "A contact with this LinkedIn URL already exists" });
      }
      throw e;
    }
    if (list_id) {
      try {
        db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)").run(list_id, id);
      } catch { /* ignore */ }
    }
    return res.status(201).json(db.prepare("SELECT * FROM targets WHERE id = ?").get(id));
  }

  if (req.method === "DELETE") {
    const db = getDb();
    const { target_ids } = req.body as { target_ids?: string[] };
    if (!Array.isArray(target_ids) || target_ids.length === 0) {
      return res.status(400).json({ error: "target_ids must be a non-empty array" });
    }
    const placeholders = target_ids.map(() => "?").join(",");
    // run_profiles/logs have no ON DELETE CASCADE — clear them first so the FK
    // constraint doesn't block the delete. run_profile_tracks cascade off run_profiles.
    const result = db.transaction(() => {
      db.prepare(`DELETE FROM run_profiles WHERE target_id IN (${placeholders})`).run(...target_ids);
      db.prepare(`DELETE FROM logs WHERE target_id IN (${placeholders})`).run(...target_ids);
      return db.prepare(`DELETE FROM targets WHERE id IN (${placeholders})`).run(...target_ids);
    })();
    return res.json({ deleted: result.changes });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).end();
  }

  const db = getDb();
  const { list_id, page = "0", limit = "50", search } = req.query;
  const offset = Number(page) * Number(limit);

  const extraClauses: string[] = [];
  const extraParams: unknown[] = [];

  if (search && typeof search === "string" && search.trim()) {
    const like = `%${search.trim()}%`;
    extraClauses.push("(t.full_name LIKE ? OR t.company LIKE ? OR t.title LIKE ?)");
    extraParams.push(like, like, like);
  }

  const filters = parseFilters(req.query);
  const { sql: filterSql, params: filterParams } = buildFilterClause(filters);

  const extraWhere =
    (extraClauses.length > 0 ? " AND " + extraClauses.join(" AND ") : "") + filterSql;
  const allExtraParams = [...extraParams, ...filterParams];

  const SELECT = `SELECT t.id, t.linkedin_url, t.full_name, t.title, t.company, t.location,
          t.email, t.email_status, t.degree,
          t.connection_requested_at, t.connected_at, t.message_sent_at, t.last_replied_at,
          t.apollo_enriched_at, t.seniority, t.created_at
   FROM targets t`;

  let rows: unknown[];
  let total: number;

  if (list_id) {
    rows = db
      .prepare(
        `${SELECT}
         JOIN list_targets lt ON lt.target_id = t.id
         WHERE lt.list_id = ?${extraWhere}
         ORDER BY t.full_name ASC
         LIMIT ? OFFSET ?`
      )
      .all(list_id, ...allExtraParams, Number(limit), offset);
    total = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM targets t
           JOIN list_targets lt ON lt.target_id = t.id
           WHERE lt.list_id = ?${extraWhere}`
        )
        .get(list_id, ...allExtraParams) as { c: number }
    ).c;
  } else {
    // All contacts — including list-less ones (e.g. created via the MCP without a list_id).
    // Previously gated behind EXISTS(list_targets), which hid them entirely.
    const whereClause = extraWhere ? `WHERE 1=1${extraWhere}` : "";
    rows = db
      .prepare(
        `${SELECT}
         ${whereClause}
         ORDER BY t.full_name ASC
         LIMIT ? OFFSET ?`
      )
      .all(...allExtraParams, Number(limit), offset);
    total = (
      db
        .prepare(`SELECT COUNT(*) as c FROM targets t ${whereClause}`)
        .get(...allExtraParams) as { c: number }
    ).c;
  }

  return res.json({ contacts: rows, total });
}
