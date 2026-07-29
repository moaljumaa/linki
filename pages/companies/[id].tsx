import Head from "next/head";
import Link from "next/link";
import { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import {
  RiArrowLeftLine, RiExternalLinkLine, RiGlobalLine,
  RiMapPinLine, RiBuildingLine, RiLinkedinBoxLine, RiUserLine,
  RiMailLine, RiPhoneLine, RiMoneyDollarCircleLine, RiCalendarLine,
  RiGroupLine, RiCodeBoxLine, RiPriceTagLine, RiErrorWarningLine,
} from "react-icons/ri";

interface Contact {
  id: string;
  full_name: string | null;
  title: string | null;
  email: string | null;
  email_status: string | null;
  seniority: string | null;
  linkedin_url: string | null;
  degree: number | null;
  connected_at: string | null;
}

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  linkedin_url: string | null;
  website: string | null;
  description: string | null;
  employee_count: number | null;
  founded_year: number | null;
  annual_revenue: string | null;
  phone: string | null;
  technology_names: string | null;
  keywords: string | null;
  notes: string | null;
  email_domain_invalid: number | null;
  created_at: string;
  contacts: Contact[];
}

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const db = getDb();
  const id = params?.id as string;
  const company = db.prepare(`
    SELECT id, name, domain, industry, location, city, country, linkedin_url, website,
           description, employee_count, founded_year, annual_revenue, phone,
           technology_names, keywords, notes, email_domain_invalid, created_at
    FROM companies WHERE id = ?
  `).get(id) as Company | undefined;
  if (!company) return { notFound: true };
  const contacts = db.prepare(`
    SELECT id, full_name, title, email, email_status, seniority, linkedin_url, degree, connected_at
    FROM targets WHERE company_id = ? ORDER BY full_name COLLATE NOCASE
  `).all(id) as Contact[];
  return { props: { company: { ...company, contacts } } };
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] text-base-content/40 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-sm text-base-content/80">{value}</div>
    </div>
  );
}

export default function CompanyDetailPage({ company }: { company: Company }) {
  return (
    <>
      <Head>
        <title>{company.name} — Companies — Linki</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="max-w-2xl">
        {/* Back */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/companies" className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors">
            <RiArrowLeftLine size={16} />
          </Link>
          <span className="text-base-content/40 text-sm">Companies</span>
        </div>

        {/* Header */}
        <div className="bg-base-200 border border-base-300/50 rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-10 h-10 rounded-lg bg-base-300 flex items-center justify-center shrink-0 mt-0.5">
                <RiBuildingLine size={16} className="text-base-content/40" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">{company.name}</h1>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  {company.industry && <span className="text-sm text-base-content/50">{company.industry}</span>}
                  {company.location && (
                    <span className="text-sm text-base-content/40 flex items-center gap-1">
                      <RiMapPinLine size={12} /> {company.location}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {company.domain && (
                    <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-base-300 text-base-content/60 hover:text-base-content hover:bg-base-300/80 transition-colors">
                      <RiGlobalLine size={12} /> {company.domain}
                    </a>
                  )}
                  {company.linkedin_url && (
                    <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-base-300 text-base-content/60 hover:text-base-content hover:bg-base-300/80 transition-colors">
                      <RiLinkedinBoxLine size={12} /> LinkedIn
                    </a>
                  )}
                  {company.website && company.website !== `https://${company.domain}` && (
                    <a href={company.website} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-base-300 text-base-content/60 hover:text-base-content hover:bg-base-300/80 transition-colors">
                      <RiExternalLinkLine size={12} /> Website
                    </a>
                  )}
                </div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-base-300 text-base-content/50 shrink-0">
              <RiUserLine size={11} /> {company.contacts.length} contacts
            </span>
          </div>
        </div>

        {/* Email domain invalid warning */}
        {!!company.email_domain_invalid && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-warning/10 border border-warning/20 mb-4 text-sm text-warning">
            <RiErrorWarningLine size={16} className="shrink-0 mt-0.5" />
            <span>Email domain flagged invalid — bounce detected for a contact at this company. All contacts have been unenrolled from email steps.</span>
          </div>
        )}

        {/* Description */}
        {company.description && (
          <div className="bg-base-200 border border-base-300/50 rounded-xl p-5 mb-4">
            <p className="text-[11px] text-base-content/40 uppercase tracking-wide mb-2">About</p>
            <p className="text-sm text-base-content/70 leading-relaxed whitespace-pre-line">{company.description}</p>
          </div>
        )}

        {/* Details grid */}
        {(company.employee_count || company.founded_year || company.annual_revenue || company.phone ||
          company.city || company.country || company.technology_names || company.keywords) && (
          <div className="bg-base-200 border border-base-300/50 rounded-xl p-5 mb-4">
            <p className="text-[11px] text-base-content/40 uppercase tracking-wide mb-3">Details</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {company.employee_count && (
                <div className="flex items-center gap-2 text-sm text-base-content/70">
                  <RiGroupLine size={13} className="text-base-content/30 shrink-0" />
                  <span>{company.employee_count.toLocaleString()} employees</span>
                </div>
              )}
              {company.founded_year && (
                <div className="flex items-center gap-2 text-sm text-base-content/70">
                  <RiCalendarLine size={13} className="text-base-content/30 shrink-0" />
                  <span>Founded {company.founded_year}</span>
                </div>
              )}
              {company.annual_revenue && (
                <div className="flex items-center gap-2 text-sm text-base-content/70">
                  <RiMoneyDollarCircleLine size={13} className="text-base-content/30 shrink-0" />
                  <span>{company.annual_revenue}</span>
                </div>
              )}
              {company.phone && (
                <div className="flex items-center gap-2 text-sm text-base-content/70">
                  <RiPhoneLine size={13} className="text-base-content/30 shrink-0" />
                  <span>{company.phone}</span>
                </div>
              )}
              {(company.city || company.country) && (
                <div className="flex items-center gap-2 text-sm text-base-content/70">
                  <RiMapPinLine size={13} className="text-base-content/30 shrink-0" />
                  <span>{[company.city, company.country].filter(Boolean).join(", ")}</span>
                </div>
              )}
            </div>

            {company.technology_names && (() => {
              try {
                const tech: string[] = JSON.parse(company.technology_names!);
                if (!tech.length) return null;
                return (
                  <div className="mt-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <RiCodeBoxLine size={12} className="text-base-content/30" />
                      <p className="text-[11px] text-base-content/40 uppercase tracking-wide">Tech stack</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {tech.map(t => (
                        <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-base-300 text-base-content/50">{t}</span>
                      ))}
                    </div>
                  </div>
                );
              } catch { return null; }
            })()}

            {company.keywords && (() => {
              try {
                const kw: string[] = JSON.parse(company.keywords!);
                if (!kw.length) return null;
                return (
                  <div className="mt-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <RiPriceTagLine size={12} className="text-base-content/30" />
                      <p className="text-[11px] text-base-content/40 uppercase tracking-wide">Keywords</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {kw.map(k => (
                        <span key={k} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-base-300 text-base-content/50">{k}</span>
                      ))}
                    </div>
                  </div>
                );
              } catch { return null; }
            })()}
          </div>
        )}

        {/* Notes */}
        {company.notes && (
          <div className="bg-base-200 border border-base-300/50 rounded-xl p-5 mb-4">
            <p className="text-[11px] text-base-content/40 uppercase tracking-wide mb-2">Notes</p>
            <p className="text-sm text-base-content/70 leading-relaxed whitespace-pre-line">{company.notes}</p>
          </div>
        )}

        {/* Contacts */}
        <div className="bg-base-200 border border-base-300/50 rounded-xl p-5">
          <p className="text-[11px] text-base-content/40 uppercase tracking-wide mb-3">
            Contacts ({company.contacts.length})
          </p>
          {company.contacts.length === 0 ? (
            <p className="text-sm text-base-content/30">No contacts linked to this company.</p>
          ) : (
            <div className="flex flex-col divide-y divide-base-300/30">
              {company.contacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-base-300 flex items-center justify-center shrink-0">
                      <RiUserLine size={13} className="text-base-content/40" />
                    </div>
                    <div className="min-w-0">
                      <Link href={`/contacts/${c.id}`} className="text-sm font-medium hover:text-primary transition-colors truncate block">
                        {c.full_name ?? "—"}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        {c.title && <span className="text-xs text-base-content/40 truncate">{c.title}</span>}
                        {c.seniority && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-base-300 text-base-content/40 capitalize shrink-0">{c.seniority}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.email && (
                      <a href={`mailto:${c.email}`} title={c.email}
                        className={c.email_status === "invalid" ? "text-error/60 hover:text-error transition-colors" : "text-success/60 hover:text-success transition-colors"}>
                        <RiMailLine size={14} />
                      </a>
                    )}
                    {c.degree === 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success">1st</span>
                    )}
                    {c.linkedin_url && (
                      <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-base-content/30 hover:text-base-content/60 transition-colors">
                        <RiExternalLinkLine size={13} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
