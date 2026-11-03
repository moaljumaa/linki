import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const SCRIPT_VARS = ["salutation", "first_name", "last_name", "full_name", "company", "title", "phone"] as const;

export interface ScriptContact {
  salutation?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  company?: string | null;
  title?: string | null;
  phone?: string | null;
}

// Fill {{variables}} from the contact; filled values are bolded so the caller's eye lands on them.
export function fillScript(body: string, c: ScriptContact) {
  const vals: Record<string, string | null | undefined> = {
    salutation: c.salutation,
    first_name: c.first_name || c.full_name?.split(" ")[0],
    last_name: c.last_name,
    full_name: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" "),
    company: c.company,
    title: c.title,
    phone: c.phone,
  };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => {
    if (!(k in vals)) return m;
    return vals[k] ? `**${vals[k]}**` : `**[${k.replace("_", " ")}]**`;
  });
}

export default function ScriptView({ body, large = false }: { body: string; large?: boolean }) {
  const t = large ? "text-lg leading-relaxed" : "text-sm leading-relaxed";
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: (p) => <h1 className="text-2xl font-semibold text-base-content mt-1 mb-3" {...p} />,
        h2: (p) => <h2 className="text-lg font-semibold text-primary mt-6 mb-2" {...p} />,
        h3: (p) => <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/50 mt-5 mb-1.5" {...p} />,
        p: (p) => <p className={`${t} text-base-content/85 mb-3`} {...p} />,
        ul: (p) => <ul className={`${t} text-base-content/85 list-disc pl-5 mb-3 space-y-1`} {...p} />,
        ol: (p) => <ol className={`${t} text-base-content/85 list-decimal pl-5 mb-3 space-y-1`} {...p} />,
        strong: (p) => <strong className="font-semibold text-warning" {...p} />,
        em: (p) => <em className="text-base-content/60" {...p} />,
        blockquote: (p) => <blockquote className={`${t} border-l-2 border-primary/40 pl-4 my-3 text-base-content/70 italic`} {...p} />,
        hr: () => <hr className="border-base-300/50 my-5" />,
        a: (p) => <a className="text-primary underline" target="_blank" rel="noopener noreferrer" {...p} />,
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
