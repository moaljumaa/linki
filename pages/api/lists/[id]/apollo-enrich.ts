import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { matchPerson } from "@/lib/apollo";
import { randomUUID } from "crypto";
import { decryptSecret } from "@/lib/crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = req.query.id as string;

  const list = db.prepare("SELECT id FROM lists WHERE id = ?").get(listId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const integration = db.prepare("SELECT api_key FROM integrations WHERE key = 'apollo'").get() as
    | { api_key: string }
    | undefined;
  if (!integration?.api_key) {
    return res.status(400).json({ error: "Apollo integration not configured" });
  }
  const apiKey = decryptSecret(integration.api_key)!;

  // Optional: target_ids in body to enrich specific contacts only
  const { target_ids } = req.body as { target_ids?: string[] };

  let targets: { id: string; linkedin_url: string | null; sales_nav_url: string | null }[];
  if (target_ids && target_ids.length > 0) {
    const placeholders = target_ids.map(() => "?").join(",");
    targets = db.prepare(`
      SELECT t.id, t.linkedin_url, t.sales_nav_url
      FROM targets t
      INNER JOIN list_targets lt ON lt.target_id = t.id
      WHERE lt.list_id = ? AND t.id IN (${placeholders}) AND t.email IS NULL
        AND (t.linkedin_url IS NOT NULL OR t.sales_nav_url IS NOT NULL)
    `).all(listId, ...target_ids) as { id: string; linkedin_url: string | null; sales_nav_url: string | null }[];
  } else {
    targets = db.prepare(`
      SELECT t.id, t.linkedin_url, t.sales_nav_url
      FROM targets t
      INNER JOIN list_targets lt ON lt.target_id = t.id
      WHERE lt.list_id = ? AND t.apollo_enriched_at IS NULL AND t.email IS NULL
        AND (t.linkedin_url IS NOT NULL OR t.sales_nav_url IS NOT NULL)
    `).all(listId) as { id: string; linkedin_url: string | null; sales_nav_url: string | null }[];
  }

  let enriched = 0;
  let notFound = 0;
  let skipped = 0;

  for (const target of targets) {
    // Prefer real /in/ URL, fall back to sales_nav_url (Apollo accepts both)
    const urlToUse = (target.linkedin_url && !target.linkedin_url.includes("/sales/lead/"))
      ? target.linkedin_url
      : target.sales_nav_url;
    if (!urlToUse) {
      skipped++;
      continue;
    }

    try {
      const result = await matchPerson(urlToUse, apiKey);

      if (!result) {
        notFound++;
        // Mark as attempted so we don't retry endlessly
        db.prepare("UPDATE targets SET apollo_enriched_at = datetime('now') WHERE id = ?").run(target.id);
        continue;
      }

      // Company association via domain
      let companyId: string | null = null;
      if (result.organization?.domain) {
        const domain = result.organization.domain.replace(/^www\./, "").toLowerCase();
        const existing = db.prepare("SELECT id FROM companies WHERE domain = ?").get(domain) as
          | { id: string }
          | undefined;
        const org = result.organization;
        if (existing) {
          companyId = existing.id;
          // Update company with richer data if we have it
          db.prepare(`
            UPDATE companies SET
              industry = COALESCE(industry, ?),
              location = COALESCE(location, ?),
              linkedin_url = COALESCE(linkedin_url, ?),
              website = COALESCE(website, ?),
              founded_year = COALESCE(founded_year, ?),
              logo_url = COALESCE(logo_url, ?),
              phone = COALESCE(phone, ?),
              annual_revenue = COALESCE(annual_revenue, ?),
              technology_names = COALESCE(technology_names, ?),
              keywords = COALESCE(keywords, ?),
              city = COALESCE(city, ?),
              country = COALESCE(country, ?),
              description = COALESCE(description, ?),
              employee_count = COALESCE(employee_count, ?)
            WHERE id = ?
          `).run(
            org.industry ?? null,
            org.location ?? null,
            org.linkedin_url ?? null,
            org.website_url ?? null,
            org.founded_year ?? null,
            org.logo_url ?? null,
            org.phone ?? null,
            org.annual_revenue_printed ?? null,
            org.technology_names ? JSON.stringify(org.technology_names) : null,
            org.keywords ? JSON.stringify(org.keywords) : null,
            org.city ?? null,
            org.country ?? null,
            org.short_description ?? null,
            org.estimated_num_employees ?? null,
            existing.id
          );
        } else {
          companyId = randomUUID();
          db.prepare(`
            INSERT INTO companies (id, name, domain, industry, location, linkedin_url, website, founded_year, logo_url, phone, annual_revenue, technology_names, keywords, city, country, description, employee_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            companyId,
            org.name ?? "",
            domain,
            org.industry ?? null,
            org.location ?? null,
            org.linkedin_url ?? null,
            org.website_url ?? null,
            org.founded_year ?? null,
            org.logo_url ?? null,
            org.phone ?? null,
            org.annual_revenue_printed ?? null,
            org.technology_names ? JSON.stringify(org.technology_names) : null,
            org.keywords ? JSON.stringify(org.keywords) : null,
            org.city ?? null,
            org.country ?? null,
            org.short_description ?? null,
            org.estimated_num_employees ?? null
          );
        }
      }

      // Apollo returns a real /in/ URL — always write it, even if target already has a Sales Nav URL
      const apolloLinkedinUrl = result.linkedin_url?.includes("/in/") ? result.linkedin_url : null;

      db.prepare(`
        UPDATE targets SET
          apollo_id = ?,
          seniority = ?,
          apollo_functions = ?,
          apollo_departments = ?,
          email = COALESCE(email, ?),
          email_status = COALESCE(email_status, ?),
          email_domain_catchall = ?,
          city = COALESCE(city, ?),
          country = COALESCE(country, ?),
          time_zone = COALESCE(time_zone, ?),
          headline = COALESCE(headline, ?),
          positions_json = COALESCE(positions_json, ?),
          company_id = COALESCE(company_id, ?),
          linkedin_url = COALESCE(?, linkedin_url),
          company_size = COALESCE(company_size, ?),
          apollo_enriched_at = datetime('now')
        WHERE id = ?
      `).run(
        result.apollo_id,
        result.seniority ?? null,
        result.functions ? JSON.stringify(result.functions) : null,
        result.departments ? JSON.stringify(result.departments) : null,
        result.email ?? null,
        result.email_status ?? null,
        result.email_domain_catchall ? 1 : 0,
        result.city ?? null,
        result.country ?? null,
        result.time_zone ?? null,
        result.headline ?? null,
        result.positions_json ?? null,
        companyId,
        apolloLinkedinUrl,
        result.organization?.estimated_num_employees ?? null,
        target.id
      );

      enriched++;
    } catch {
      skipped++;
    }
  }

  return res.json({ enriched, notFound, skipped, total: targets.length });
}

export const config = {
  api: { responseLimit: false },
};
