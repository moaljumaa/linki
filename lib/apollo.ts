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
