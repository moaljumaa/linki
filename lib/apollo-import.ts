import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import {
  searchContactsByLabel,
  matchPerson,
  upsertCompanyFromOrg,
  applyApolloMatchResult,
  type ApolloListContact,
} from "@/lib/apollo";

type DB = Database.Database;
const PAGE_SIZE = 100;

/** Queues an Apollo list import and fires the async loop. Mirrors lib/import-jobs.ts conventions. */
export function startApolloImport(
  db: DB,
  opts: { listId: string; apolloListId: string; enrich: boolean }
): { importId: string } {
  const importId = randomUUID();
  db.prepare(
    `INSERT INTO list_imports (id, list_id, source, apollo_list_id, status, phase, enrich, started_at)
     VALUES (?, ?, 'apollo', ?, 'running', 'importing', ?, datetime('now'))`
  ).run(importId, opts.listId, opts.apolloListId, opts.enrich ? 1 : 0);

  runApolloImport(importId).catch((err) => {
    console.error("[apollo-import] crashed:", err);
    getDb()
      .prepare("UPDATE list_imports SET status='error', error=?, finished_at=datetime('now') WHERE id=?")
      .run(err instanceof Error ? err.message : String(err), importId);
  });

  return { importId };
}

const insertTargetSql = `
  INSERT INTO targets (
    id, linkedin_url, first_name, last_name, full_name, title, company, location,
    headline, email, email_status, phone, city, country, time_zone, apollo_id, company_id,
    apollo_enriched_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(linkedin_url) DO UPDATE SET
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    full_name = excluded.full_name,
    title = excluded.title,
    company = excluded.company,
    location = excluded.location,
    headline = COALESCE(headline, excluded.headline),
    email = COALESCE(email, excluded.email),
    email_status = COALESCE(email_status, excluded.email_status),
    phone = COALESCE(phone, excluded.phone),
    city = COALESCE(city, excluded.city),
    country = COALESCE(country, excluded.country),
    time_zone = COALESCE(time_zone, excluded.time_zone),
    apollo_id = COALESCE(apollo_id, excluded.apollo_id),
    company_id = COALESCE(company_id, excluded.company_id)
`;

function insertContacts(
  db: DB,
  listId: string,
  contacts: ApolloListContact[]
): { imported: number; skipped: number } {
  const insertTarget = db.prepare(insertTargetSql);
  const insertLink = db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)");
  const findTarget = db.prepare("SELECT id FROM targets WHERE linkedin_url = ?");

  let imported = 0;
  let skipped = 0;

  db.transaction(() => {
    for (const c of contacts) {
      if (!c.linkedinUrl) {
        skipped++;
        continue;
      }
      const companyId = c.organization
        ? upsertCompanyFromOrg(db, { ...c.organization, name: c.organizationName })
        : null;

      insertTarget.run(
        randomUUID(),
        c.linkedinUrl,
        c.firstName,
        c.lastName,
        c.fullName,
        c.title,
        c.organizationName,
        c.location,
        c.headline,
        c.email,
        c.emailStatus,
        c.phone,
        c.city,
        c.country,
        c.timeZone,
        c.personId,
        companyId,
        c.email ? new Date().toISOString() : null
      );
      const target = findTarget.get(c.linkedinUrl) as { id: string };
      const result = insertLink.run(listId, target.id);
      if (result.changes > 0) imported++;
      else skipped++;
    }
  })();

  return { imported, skipped };
}

async function runApolloImport(importId: string): Promise<void> {
  const db = getDb();
  const job = db.prepare("SELECT list_id, apollo_list_id, enrich FROM list_imports WHERE id = ?").get(importId) as
    | { list_id: string; apollo_list_id: string; enrich: number }
    | undefined;
  if (!job) return;

  const integration = db.prepare("SELECT api_key FROM integrations WHERE key = 'apollo'").get() as
    | { api_key: string }
    | undefined;
  const apiKey = integration?.api_key ? decryptSecret(integration.api_key) : null;
  if (!apiKey) {
    db.prepare("UPDATE list_imports SET status='error', error=?, finished_at=datetime('now') WHERE id=?").run(
      "Apollo integration not configured",
      importId
    );
    return;
  }

  const updateProgress = db.prepare(
    "UPDATE list_imports SET page=?, total_pages=?, count=?, total=?, imported=?, skipped=? WHERE id=?"
  );
  const isCanceled = (): boolean => {
    const row = db.prepare("SELECT cancel_requested FROM list_imports WHERE id = ?").get(importId) as
      | { cancel_requested: number }
      | undefined;
    if (!row) return true; // import row was deleted
    if (row.cancel_requested === 1) return true;
    const list = db.prepare("SELECT id FROM lists WHERE id = ?").get(job.list_id);
    return !list; // parent list was deleted
  };

  let imported = 0;
  let skipped = 0;
  let page = 1;
  let totalPages = 1;

  try {
    do {
      if (isCanceled()) {
        db.prepare("UPDATE list_imports SET status='canceled', finished_at=datetime('now') WHERE id=?").run(importId);
        return;
      }

      const result = await searchContactsByLabel(apiKey, job.apollo_list_id, page, PAGE_SIZE);
      totalPages = result.totalPages;

      const { imported: imp, skipped: skip } = insertContacts(db, job.list_id, result.contacts);
      imported += imp;
      skipped += skip;

      if (job.enrich === 1) {
        for (const c of result.contacts) {
          if (!c.linkedinUrl) continue;
          try {
            const matchResult = await matchPerson(c.linkedinUrl, apiKey);
            if (matchResult) {
              const target = db.prepare("SELECT id FROM targets WHERE linkedin_url = ?").get(c.linkedinUrl) as
                | { id: string }
                | undefined;
              if (target) applyApolloMatchResult(db, target.id, matchResult);
            }
          } catch {
            // leave the base import data, move on
          }
        }
      }

      updateProgress.run(page, totalPages, imported + skipped, result.totalEntries, imported, skipped, importId);
      page++;
    } while (page <= totalPages);

    db.prepare("UPDATE list_imports SET status='done', finished_at=datetime('now') WHERE id=?").run(importId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      "UPDATE list_imports SET status='error', error=?, imported=?, skipped=?, finished_at=datetime('now') WHERE id=?"
    ).run(message, imported, skipped, importId);
  }
}
