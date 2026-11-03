import { useState, useRef, useEffect } from "react";
import { RiAddLine, RiCloseLine, RiFilter3Line } from "react-icons/ri";

// ─── Field definitions ───────────────────────────────────────────────────────

export type FieldType = "enum" | "presence" | "boolean" | "number" | "text";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
}

export const FILTER_FIELDS: FieldDef[] = [
  {
    key: "connection_status",
    label: "Connection",
    type: "enum",
    options: [
      { value: "not_contacted", label: "Not contacted" },
      { value: "request_sent", label: "Request sent" },
      { value: "connected", label: "Connected (1st)" },
      { value: "messaged", label: "Messaged" },
      { value: "replied", label: "Replied" },
    ],
  },
  {
    key: "seniority",
    label: "Seniority",
    type: "enum",
    options: [
      { value: "owner", label: "Owner" },
      { value: "founder", label: "Founder" },
      { value: "c_suite", label: "C-Suite" },
      { value: "partner", label: "Partner" },
      { value: "vp", label: "VP" },
      { value: "head", label: "Head" },
      { value: "director", label: "Director" },
      { value: "manager", label: "Manager" },
      { value: "senior", label: "Senior" },
      { value: "entry", label: "Entry" },
      { value: "intern", label: "Intern" },
    ],
  },
  {
    key: "email_status",
    label: "Email status",
    type: "enum",
    options: [
      { value: "verified", label: "Verified" },
      { value: "unverified", label: "Unverified" },
      { value: "invalid", label: "Invalid" },
      { value: "catchall", label: "Catch-all" },
    ],
  },
  {
    key: "degree",
    label: "Degree",
    type: "enum",
    options: [
      { value: "1", label: "1st" },
      { value: "2", label: "2nd" },
      { value: "3", label: "3rd" },
    ],
  },
  {
    key: "email",
    label: "Email",
    type: "presence",
  },
  {
    key: "apollo_enriched_at",
    label: "Apollo enriched",
    type: "presence",
  },
  {
    key: "connection_requested_at",
    label: "Connection request",
    type: "presence",
  },
  {
    key: "connected_at",
    label: "Connected at",
    type: "presence",
  },
  {
    key: "message_sent_at",
    label: "Message sent",
    type: "presence",
  },
  {
    key: "last_replied_at",
    label: "Replied",
    type: "presence",
  },
  {
    key: "open_link",
    label: "Open link",
    type: "boolean",
  },
  {
    key: "email_domain_catchall",
    label: "Catch-all domain",
    type: "boolean",
  },
  {
    key: "company_size",
    label: "Company size",
    type: "number",
  },
  {
    key: "tenure_months",
    label: "Tenure (months)",
    type: "number",
  },
  {
    key: "country",
    label: "Country",
    type: "text",
  },
  {
    key: "company_industry",
    label: "Industry",
    type: "text",
  },
  {
    key: "company",
    label: "Company",
    type: "text",
  },
];

// ─── Filter model ─────────────────────────────────────────────────────────────

export type FilterOp =
  | "is" | "is_not"           // enum / text
  | "contains"                // text
  | "is_set" | "is_not_set"  // presence
  | "is_true" | "is_false"   // boolean
  | "gt" | "lt";             // number

export interface ActiveFilter {
  id: string;
  field: string;
  op: FilterOp;
  value?: string;
}

function opLabel(op: FilterOp): string {
  switch (op) {
    case "is": return "is";
    case "is_not": return "is not";
    case "contains": return "contains";
    case "is_set": return "is set";
    case "is_not_set": return "is not set";
    case "is_true": return "is true";
    case "is_false": return "is false";
    case "gt": return ">";
    case "lt": return "<";
  }
}

function opsForField(field: FieldDef): FilterOp[] {
  switch (field.type) {
    case "enum": return ["is", "is_not"];
    case "presence": return ["is_set", "is_not_set"];
    case "boolean": return ["is_true", "is_false"];
    case "number": return ["gt", "lt"];
    case "text": return ["contains", "is", "is_not"];
  }
}

function defaultOp(field: FieldDef): FilterOp {
  return opsForField(field)[0];
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

function FilterChip({
  filter,
  onRemove,
  onChange,
}: {
  filter: ActiveFilter;
  onRemove: () => void;
  onChange: (updated: ActiveFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fieldDef = FILTER_FIELDS.find((f) => f.key === filter.field)!;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const ops = opsForField(fieldDef);
  const needsValue = !["is_set", "is_not_set", "is_true", "is_false"].includes(filter.op);

  // Chip label
  const valueLabel =
    fieldDef.options?.find((o) => o.value === filter.value)?.label ?? filter.value ?? "";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-lg text-xs font-medium border transition-colors ${
          open
            ? "bg-primary/15 border-primary/40 text-primary"
            : "bg-base-200 border-base-300/60 text-base-content/70 hover:border-base-300 hover:text-base-content"
        }`}
      >
        <span className="text-base-content/50">{fieldDef.label}</span>
        <span className="text-base-content/30 mx-0.5">·</span>
        <span className="text-base-content/70">{opLabel(filter.op)}</span>
        {needsValue && filter.value && (
          <>
            <span className="text-base-content/30 mx-0.5">·</span>
            <span className="font-semibold text-base-content">{valueLabel}</span>
          </>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-1 w-4 h-4 rounded flex items-center justify-center text-base-content/30 hover:text-base-content/70 hover:bg-base-300/60 transition-colors"
        >
          <RiCloseLine size={11} />
        </button>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-base-200 border border-base-300/60 rounded-xl shadow-xl shadow-black/30 p-3 flex flex-col gap-2.5 min-w-55">
          {/* Field label */}
          <div className="text-xs font-semibold text-base-content/40 uppercase tracking-wider px-0.5">
            {fieldDef.label}
          </div>

          {/* Operator */}
          <div className="flex flex-wrap gap-1">
            {ops.map((op) => (
              <button
                key={op}
                onClick={() => onChange({ ...filter, op, value: undefined })}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  filter.op === op
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "bg-base-300/50 text-base-content/50 border border-transparent hover:text-base-content hover:bg-base-300"
                }`}
              >
                {opLabel(op)}
              </button>
            ))}
          </div>

          {/* Value input */}
          {needsValue && (
            <div>
              {fieldDef.type === "enum" && fieldDef.options ? (
                <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                  {fieldDef.options.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { onChange({ ...filter, value: opt.value }); setOpen(false); }}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                        filter.value === opt.value
                          ? "bg-primary/15 text-primary font-medium"
                          : "text-base-content/70 hover:bg-base-300/60 hover:text-base-content"
                      }`}
                    >
                      {filter.value === opt.value && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      )}
                      {filter.value !== opt.value && (
                        <span className="w-1.5 h-1.5 shrink-0" />
                      )}
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  autoFocus
                  type={fieldDef.type === "number" ? "number" : "text"}
                  placeholder="Value…"
                  value={filter.value ?? ""}
                  onChange={(e) => onChange({ ...filter, value: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && setOpen(false)}
                  className="w-full bg-base-300/50 border border-base-300/80 rounded-lg px-2.5 py-1.5 text-xs text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/50"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add filter dropdown ───────────────────────────────────────────────────────

function AddFilterButton({ onAdd, fields }: { onAdd: (field: string) => void; fields: FieldDef[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = fields.filter((f) =>
    f.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium text-base-content/40 border border-dashed border-base-300/60 hover:text-base-content/70 hover:border-base-300 hover:bg-base-200/50 transition-colors"
      >
        <RiAddLine size={12} />
        Add filter
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-base-200 border border-base-300/60 rounded-xl shadow-xl shadow-black/30 w-52 overflow-hidden">
          <div className="p-2 border-b border-base-300/50">
            <input
              autoFocus
              type="text"
              placeholder="Search fields…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-base-300/50 border border-base-300/60 rounded-lg px-2.5 py-1.5 text-xs text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1.5 flex flex-col gap-0.5">
            {filtered.length === 0 ? (
              <div className="text-xs text-base-content/30 px-2 py-3 text-center">No fields found</div>
            ) : (
              filtered.map((f) => (
                <button
                  key={f.key}
                  onClick={() => { onAdd(f.key); setOpen(false); setSearch(""); }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-xs text-left text-base-content/60 hover:text-base-content hover:bg-base-300/60 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-base-content/20 shrink-0" />
                  {f.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: ActiveFilter[];
  onChange: (filters: ActiveFilter[]) => void;
  fieldSubset?: string[];
}

export default function FilterBar({ filters, onChange, fieldSubset }: FilterBarProps) {
  const visibleFields = fieldSubset
    ? FILTER_FIELDS.filter((f) => fieldSubset.includes(f.key))
    : FILTER_FIELDS;

  function addFilter(fieldKey: string) {
    const fieldDef = FILTER_FIELDS.find((f) => f.key === fieldKey)!;
    const newFilter: ActiveFilter = {
      id: Math.random().toString(36).slice(2),
      field: fieldKey,
      op: defaultOp(fieldDef),
    };
    onChange([...filters, newFilter]);
  }

  function updateFilter(id: string, updated: ActiveFilter) {
    onChange(filters.map((f) => (f.id === id ? updated : f)));
  }

  function removeFilter(id: string) {
    onChange(filters.filter((f) => f.id !== id));
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {filters.length > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-base-content/30 pr-0.5">
          <RiFilter3Line size={11} />
        </span>
      )}
      {filters.map((f) => (
        <FilterChip
          key={f.id}
          filter={f}
          onRemove={() => removeFilter(f.id)}
          onChange={(updated) => updateFilter(f.id, updated)}
        />
      ))}
      <AddFilterButton onAdd={addFilter} fields={visibleFields} />
      {filters.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="text-xs text-base-content/30 hover:text-base-content/60 transition-colors px-1 h-7"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ─── Client-side filter logic (for list detail page) ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyFiltersClient<T>(items: T[], filters: ActiveFilter[]): T[] {
  if (filters.length === 0) return items;
  return items.filter((item) => filters.every((f) => matchesFilter(item as Record<string, unknown>, f)));
}

function matchesFilter(item: Record<string, unknown>, filter: ActiveFilter): boolean {
  // connection_status is a derived field — handle specially
  if (filter.field === "connection_status") {
    const degree = item.degree as number | null;
    const crAt = item.connection_requested_at as string | null;
    const msgAt = item.message_sent_at as string | null;
    const repAt = item.last_replied_at as string | null;

    let status: string;
    if (repAt) status = "replied";
    else if (msgAt) status = "messaged";
    else if (degree === 1) status = "connected";
    else if (crAt) status = "request_sent";
    else status = "not_contacted";

    if (filter.op === "is") return status === filter.value;
    if (filter.op === "is_not") return status !== filter.value;
    return true;
  }

  const raw = item[filter.field];

  switch (filter.op) {
    case "is_set": return raw !== null && raw !== undefined && raw !== "";
    case "is_not_set": return raw === null || raw === undefined || raw === "";
    case "is_true": return raw === 1 || raw === true || raw === "1";
    case "is_false": return raw === 0 || raw === false || raw === "0" || raw === null || raw === undefined;
    case "is": return String(raw ?? "").toLowerCase() === String(filter.value ?? "").toLowerCase();
    case "is_not": return String(raw ?? "").toLowerCase() !== String(filter.value ?? "").toLowerCase();
    case "contains": return String(raw ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
    case "gt": return Number(raw) > Number(filter.value ?? 0);
    case "lt": return Number(raw) < Number(filter.value ?? 0);
    default: return true;
  }
}

// ─── Server-side filter → query params (for contacts page) ───────────────────

export function filtersToParams(filters: ActiveFilter[]): URLSearchParams {
  const params = new URLSearchParams();
  filters.forEach((f, i) => {
    params.set(`f[${i}][field]`, f.field);
    params.set(`f[${i}][op]`, f.op);
    if (f.value !== undefined) params.set(`f[${i}][value]`, f.value);
  });
  return params;
}
