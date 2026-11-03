import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

const APOLLO_BASE = "https://api.apollo.io/api/v1";

export interface ApolloMatchResult {
  apollo_id: string;
  linkedin_url: string | null;
  headline: string | null;
  seniority: string | null;
  functions: string[] | null;
  departments: string[] | null;
  email: string | null;
  email_status: string | null;
  email_domain_catchall: boolean;
  city: string | null;
  country: string | null;
  time_zone: string | null;
  positions_json: string | null;
  organization: {
    name: string | null;
    domain: string | null;
    industry: string | null;
    estimated_num_employees: number | null;
    short_description: string | null;
    location: string | null;
    linkedin_url: string | null;
    website_url: string | null;
    founded_year: number | null;
    logo_url: string | null;
    phone: string | null;
    annual_revenue_printed: string | null;
    technology_names: string[] | null;
    keywords: string[] | null;
    city: string | null;
    country: string | null;
  } | null;
}

export async function matchPerson(
  linkedinUrl: string,
  apiKey: string
): Promise<ApolloMatchResult | null> {
  const res = await fetch(`${APOLLO_BASE}/people/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({ linkedin_url: linkedinUrl, reveal_personal_emails: false }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const p = data.person;
  if (!p || !p.id) return null;

  const org = p.organization ?? null;
  const location =
    org
      ? [org.city, org.country].filter(Boolean).join(", ") || null
      : null;

  // Map employment_history to positions_json format (same shape as Sales Nav enrichment)
  let positions_json: string | null = null;
  if (Array.isArray(p.employment_history) && p.employment_history.length > 0) {
    const positions = p.employment_history.map((e: Record<string, unknown>) => ({
      title: e.title ?? "",
      companyName: e.organization_name ?? "",
      current: e.current === true,
      startDate: e.start_date ?? undefined,
      endDate: e.end_date ?? undefined,
    }));
    positions_json = JSON.stringify(positions);
  }

  return {
    apollo_id: p.id,
    linkedin_url: p.linkedin_url ?? null,
    headline: p.headline ?? null,
    seniority: p.seniority ?? null,
    functions: Array.isArray(p.functions) && p.functions.length > 0 ? p.functions : null,
    departments: Array.isArray(p.departments) && p.departments.length > 0 ? p.departments : null,
    email: p.email ?? null,
    email_status: p.email_status ?? null,
    email_domain_catchall: p.email_domain_catchall === true,
    city: p.city ?? null,
    country: p.country ?? null,
    time_zone: p.time_zone ?? null,
    positions_json,
    organization: org
      ? {
          name: org.name ?? null,
          domain: org.primary_domain ?? null,
          industry: org.industry ?? null,
          estimated_num_employees: org.estimated_num_employees ?? null,
          short_description: org.short_description ?? null,
          location,
          linkedin_url: org.linkedin_url ?? null,
          website_url: org.website_url ?? null,
          founded_year: org.founded_year ?? null,
          logo_url: org.logo_url ?? null,
          phone: org.phone ?? org.sanitized_phone ?? null,
          annual_revenue_printed: org.annual_revenue_printed ?? null,
          technology_names: Array.isArray(org.technology_names) && org.technology_names.length > 0 ? org.technology_names : null,
          keywords: Array.isArray(org.keywords) && org.keywords.length > 0 ? org.keywords : null,
          city: org.city ?? null,
          country: org.country ?? null,
        }
      : null,
  };
}

export interface ApolloList {
  id: string;
  name: string;
  count: number;
}

/** GET /v1/labels — Apollo's saved lists. Requires a Master API key. Filtered to person (contact) lists. */
export async function listApolloLists(apiKey: string): Promise<ApolloList[]> {
  const res = await fetch(`${APOLLO_BASE}/labels`, {
    headers: { "X-Api-Key": apiKey },
  });
  if (!res.ok) throw new Error(`Apollo /labels failed: ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .filter((l: Record<string, unknown>) => l.modality === "contacts")
    .map((l: Record<string, unknown>) => ({
      id: String(l.id ?? l._id),
      name: String(l.name ?? "Untitled list"),
      count: Number(l.cached_count ?? 0),
    }));
}

export interface ApolloListContact {
  personId: string | null;
  linkedinUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  title: string | null;
  headline: string | null;
  email: string | null;
  emailStatus: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  timeZone: string | null;
  location: string | null;
  organizationName: string | null;
  organization: {
    domain: string | null;
    linkedin_url: string | null;
    website_url: string | null;
    founded_year: number | null;
    phone: string | null;
  } | null;
}

export interface ApolloListPage {
  contacts: ApolloListContact[];
  page: number;
  totalPages: number;
  totalEntries: number;
}

/** POST /v1/contacts/search scoped to one label (list). Requires a Master API key. No credit cost. */
export async function searchContactsByLabel(
  apiKey: string,
  labelId: string,
  page: number,
  perPage = 100
): Promise<ApolloListPage> {
  const res = await fetch(`${APOLLO_BASE}/contacts/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({ contact_label_ids: [labelId], page, per_page: perPage }),
  });
  if (!res.ok) throw new Error(`Apollo /contacts/search failed: ${res.status}`);
  const data = await res.json();

  const contacts: ApolloListContact[] = (data.contacts ?? []).map((c: Record<string, unknown>) => {
    const org = c.organization as Record<string, unknown> | null;
    return {
      personId: (c.person_id as string) ?? null,
      linkedinUrl: (c.linkedin_url as string) ?? null,
      firstName: (c.first_name as string) ?? null,
      lastName: (c.last_name as string) ?? null,
      fullName: (c.name as string) ?? null,
      title: (c.title as string) ?? null,
      headline: (c.headline as string) ?? null,
      email: (c.email as string) ?? null,
      emailStatus: (c.email_status as string) ?? null,
      phone: (c.sanitized_phone as string) ?? null,
      city: (c.city as string) ?? null,
      country: (c.country as string) ?? null,
      timeZone: (c.time_zone as string) ?? null,
      location: (c.present_raw_address as string) ?? (c.formatted_address as string) ?? null,
      organizationName: (c.organization_name as string) ?? null,
      organization: org
        ? {
            domain: (org.primary_domain as string) ?? null,
            linkedin_url: (org.linkedin_url as string) ?? null,
            website_url: (org.website_url as string) ?? null,
            founded_year: (org.founded_year as number) ?? null,
            phone: (org.phone as string) ?? null,
          }
        : null,
    };
  });

  return {
    contacts,
    page: data.pagination?.page ?? page,
    totalPages: data.pagination?.total_pages ?? 1,
    totalEntries: data.pagination?.total_entries ?? contacts.length,
  };
}

/**
 * Upsert a company row by domain from Apollo organization data. Shared by apollo-enrich (rich
 * people/match org data) and Apollo list import (lighter contacts/search org data) — COALESCE
 * only fills fields that are still empty, never overwrites richer existing data.
 */
export function upsertCompanyFromOrg(
  db: Database.Database,
  org: {
    name?: string | null;
    domain?: string | null;
    industry?: string | null;
    location?: string | null;
    linkedin_url?: string | null;
    website_url?: string | null;
    founded_year?: number | null;
    logo_url?: string | null;
    phone?: string | null;
    annual_revenue_printed?: string | null;
    technology_names?: string[] | null;
    keywords?: string[] | null;
    city?: string | null;
    country?: string | null;
    short_description?: string | null;
    estimated_num_employees?: number | null;
  }
): string | null {
  if (!org.domain) return null;
  const domain = org.domain.replace(/^www\./, "").toLowerCase();

  const existing = db.prepare("SELECT id FROM companies WHERE domain = ?").get(domain) as
    | { id: string }
    | undefined;

  if (existing) {
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
    return existing.id;
  }

  const companyId = randomUUID();
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
  return companyId;
}

/**
 * Apply a people/match result to an existing target row. Shared by apollo-enrich (per-target
 * enrichment pass) and Apollo list import (optional per-contact enrich-on-import).
 */
export function applyApolloMatchResult(
  db: Database.Database,
  targetId: string,
  result: ApolloMatchResult
): void {
  const companyId = result.organization ? upsertCompanyFromOrg(db, result.organization) : null;
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
    targetId
  );
}
