// {{variable}} substitution shared by the runner, the AI writer post-processing, and the
// workflow editor's email preview — one place defines which variables exist and how they resolve.

export interface TemplateContact {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  salutation?: string | null; // "Anrede": Herr / Frau / Herr Dr. …
}

export const TEMPLATE_VARIABLES = ["first_name", "last_name", "full_name", "salutation", "company", "title", "location"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export function templateData(c: TemplateContact): Record<TemplateVariable, string> {
  const first = c.first_name ?? c.full_name?.split(" ")[0] ?? "";
  const last = c.last_name ?? c.full_name?.split(" ").slice(1).join(" ") ?? "";
  return {
    first_name: first,
    last_name: last,
    full_name: c.full_name ?? `${first} ${last}`.trim(),
    salutation: c.salutation ?? "",
    company: c.company ?? "",
    title: c.title ?? "",
    location: c.location ?? "",
  };
}

export function renderTemplate(body: string, c: TemplateContact): string {
  const data = templateData(c);
  return body
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => {
      const key = k.toLowerCase() === "anrede" ? "salutation" : (k.toLowerCase() as TemplateVariable);
      return key in data ? data[key] : m;
    })
    .trim();
}
