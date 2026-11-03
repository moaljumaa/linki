import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import type { ActiveFilter, FilterOp } from "@/components/ui/FilterBar";

function parseFilters(query: NextApiRequest["query"]): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  let i = 0;
  while (query[`f[${i}][field]`]) {
    filters.push({
      id: String(i),
      field: query[`f[${i}][field]`] as string,
      op: query[`f[${i}][op]`] as FilterOp,
      value: query[`f[${i}][value]`] as string | undefined,
    });
    i++;
  }
  return filters;
}

function buildFilterClause(filters: ActiveFilter[]): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  const ALLOWED: Record<string, string> = {
    degree: "t.degree",
    connection_requested_at: "t.connection_requested_at",
    connected_at: "t.connected_at",
    message_sent_at: "t.message_sent_at",
    company: "t.company",
    title: "t.title",
    seniority: "t.seniority",
    country: "t.country",
  };

  for (const f of filters) {
    const col = ALLOWED[f.field];
    if (!col) continue;

    switch (f.op) {
      case "is_set":
        parts.push(`${col} IS NOT NULL AND ${col} != ''`);
        break;
      case "is_not_set":
        parts.push(`(${col} IS NULL OR ${col} = '')`);
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

  return { sql: parts.length > 0 ? " AND " + parts.join(" AND ") : "", params };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  try {
    const db = getDb();
    const workflowId = req.query.id as string;
    const stepFilter = req.query.step !== undefined ? Number(req.query.step) : null;
    const trackFilter = (req.query.track as string | undefined) ?? "linkedin";
    const stateFilter = req.query.state as string | undefined;
    const search = req.query.search as string | undefined;
    const page = req.query.page ? Number(req.query.page) : 0;
    const limit = 25;
    const offset = page * limit;

    const conditions: string[] = ["r.workflow_id = ?", "r.status IN ('running', 'paused', 'completed')"];
    const params: unknown[] = [workflowId];

    if (stepFilter !== null) {
      const trackAlias = trackFilter === "email" ? "rt_em" : "rt_li";
      // Only show prospects actively at this step (exclude failed/skipped/completed at that step)
      conditions.push(`COALESCE(${trackAlias}.current_step, 0) = ? AND ${trackAlias}.state NOT IN ('completed','skipped','failed')`);
      params.push(stepFilter - 1);
    }
    if (stateFilter) {
      const states = stateFilter.split(",");
      const stateConditions = states.map((s) => {
        if (s === "completed") {
          // No active tracks, at least one completed — matches stats API definition
          return `NOT EXISTS (SELECT 1 FROM run_profile_tracks rt_sf WHERE rt_sf.run_profile_id = rp.id AND rt_sf.state IN ('in_progress','pending'))
                  AND EXISTS (SELECT 1 FROM run_profile_tracks rt_sf2 WHERE rt_sf2.run_profile_id = rp.id AND rt_sf2.state = 'completed')`;
        }
        if (s === "in_progress") {
          return "EXISTS (SELECT 1 FROM run_profile_tracks rt_sf WHERE rt_sf.run_profile_id = rp.id AND rt_sf.state = 'in_progress')";
        }
        if (s === "failed") {
          // No active tracks, no completed tracks, has a failed track
          return `NOT EXISTS (SELECT 1 FROM run_profile_tracks rt_sf WHERE rt_sf.run_profile_id = rp.id AND rt_sf.state IN ('in_progress','pending'))
                  AND NOT EXISTS (SELECT 1 FROM run_profile_tracks rt_sf2 WHERE rt_sf2.run_profile_id = rp.id AND rt_sf2.state = 'completed')
                  AND EXISTS (SELECT 1 FROM run_profile_tracks rt_sf3 WHERE rt_sf3.run_profile_id = rp.id AND rt_sf3.state = 'failed')`;
        }
        if (s === "skipped") {
          // No active tracks, no completed, no failed, has a skipped track
          return `NOT EXISTS (SELECT 1 FROM run_profile_tracks rt_sf WHERE rt_sf.run_profile_id = rp.id AND rt_sf.state IN ('in_progress','pending'))
                  AND NOT EXISTS (SELECT 1 FROM run_profile_tracks rt_sf2 WHERE rt_sf2.run_profile_id = rp.id AND rt_sf2.state = 'completed')
                  AND NOT EXISTS (SELECT 1 FROM run_profile_tracks rt_sf3 WHERE rt_sf3.run_profile_id = rp.id AND rt_sf3.state = 'failed')
                  AND EXISTS (SELECT 1 FROM run_profile_tracks rt_sf4 WHERE rt_sf4.run_profile_id = rp.id AND rt_sf4.state = 'skipped')`;
        }
        return "EXISTS (SELECT 1 FROM run_profile_tracks rt_sf WHERE rt_sf.run_profile_id = rp.id AND rt_sf.state = ?)";
      });
      const filteredStates = states.filter(s => !["completed","in_progress","failed","skipped"].includes(s));
      conditions.push(`(${stateConditions.join(" OR ")})`);
      params.push(...filteredStates);
    }
    if (search) {
      conditions.push("(t.full_name LIKE ? OR t.company LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    // Extra filters from FilterBar
    const activeFilters = parseFilters(req.query);
    const { sql: filterSql, params: filterParams } = buildFilterClause(activeFilters);
    if (filterSql) {
      conditions.push(filterSql.replace(/^ AND /, ""));
      params.push(...filterParams);
    }

    const where = conditions.join(" AND ");

    const total = (db.prepare(
      `SELECT COUNT(*) as c
       FROM run_profiles rp
       JOIN runs r ON r.id = rp.run_id
       JOIN targets t ON t.id = rp.target_id
       LEFT JOIN run_profile_tracks rt_li ON rt_li.run_profile_id = rp.id AND rt_li.track = 'linkedin'
       LEFT JOIN run_profile_tracks rt_em ON rt_em.run_profile_id = rp.id AND rt_em.track = 'email'
       WHERE ${where}`
    ).get(...params) as { c: number }).c;

    params.push(limit, offset);

    const prospects = db.prepare(
      `SELECT rp.id, rp.run_id, rp.target_id,
              CASE
                WHEN EXISTS (SELECT 1 FROM run_profile_tracks rt_a WHERE rt_a.run_profile_id = rp.id AND rt_a.state = 'in_progress') THEN 'in_progress'
                WHEN EXISTS (SELECT 1 FROM run_profile_tracks rt_a WHERE rt_a.run_profile_id = rp.id AND rt_a.state = 'pending') THEN 'pending'
                WHEN EXISTS (SELECT 1 FROM run_profile_tracks rt_a WHERE rt_a.run_profile_id = rp.id AND rt_a.state = 'failed') THEN 'failed'
                WHEN EXISTS (SELECT 1 FROM run_profile_tracks rt_a WHERE rt_a.run_profile_id = rp.id AND rt_a.state = 'skipped') THEN 'skipped'
                ELSE 'completed'
              END as state,
              COALESCE(rt_li.current_step, 0) as current_step,
              COALESCE(rt_li.next_step_at, rt_em.next_step_at) as next_step_at,
              COALESCE(rt_li.error_message, rt_em.error_message) as error_message,
              t.full_name, t.title, t.company, t.linkedin_url,
              t.degree, t.connection_requested_at, t.connected_at, t.message_sent_at,
              ws_li.step_type as li_step_type,
              ws_em.step_type as em_step_type,
              CASE
                WHEN rt_li.state NOT IN ('completed','skipped') THEN ws_li.step_type
                ELSE ws_em.step_type
              END as step_type,
              CASE
                WHEN rt_li.state NOT IN ('completed','skipped') THEN ws_li.track
                ELSE ws_em.track
              END as step_track
       FROM run_profiles rp
       JOIN runs r ON r.id = rp.run_id
       JOIN targets t ON t.id = rp.target_id
       LEFT JOIN run_profile_tracks rt_li ON rt_li.run_profile_id = rp.id AND rt_li.track = 'linkedin'
       LEFT JOIN run_profile_tracks rt_em ON rt_em.run_profile_id = rp.id AND rt_em.track = 'email'
       LEFT JOIN workflow_steps ws_li ON ws_li.workflow_id = r.workflow_id AND ws_li.track = 'linkedin' AND ws_li.step_order = COALESCE(rt_li.current_step, 0) + 1
       LEFT JOIN workflow_steps ws_em ON ws_em.workflow_id = r.workflow_id AND ws_em.track = 'email' AND ws_em.step_order = COALESCE(rt_em.current_step, 0) + 1
       WHERE ${where}
       ORDER BY
         CASE
           WHEN EXISTS (SELECT 1 FROM run_profile_tracks rt_a WHERE rt_a.run_profile_id = rp.id AND rt_a.state = 'in_progress') THEN 0
           WHEN EXISTS (SELECT 1 FROM run_profile_tracks rt_a WHERE rt_a.run_profile_id = rp.id AND rt_a.state = 'pending') THEN 1
           WHEN EXISTS (SELECT 1 FROM run_profile_tracks rt_a WHERE rt_a.run_profile_id = rp.id AND rt_a.state = 'failed') THEN 2
           WHEN EXISTS (SELECT 1 FROM run_profile_tracks rt_a WHERE rt_a.run_profile_id = rp.id AND rt_a.state = 'skipped') THEN 3
           ELSE 4
         END,
         t.full_name
       LIMIT ? OFFSET ?`
    ).all(...params);

    return res.json({ prospects, total });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
