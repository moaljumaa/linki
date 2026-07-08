import Head from "next/head";
import { useState } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { RiAddLine, RiDeleteBinLine, RiBuildingLine, RiGlobalLine } from "react-icons/ri";

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  linkedin_url: string | null;
  website: string | null;
  notes: string | null;
  contact_count: number;
  created_at: string;
}

const BLANK_FORM = { name: "", domain: "", industry: "", location: "", linkedin_url: "", website: "", notes: "" };

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const companies = db.prepare(`
    SELECT c.*, COUNT(t.id) as contact_count
    FROM companies c
    LEFT JOIN targets t ON t.company_id = c.id
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all();
  return { props: { initialCompanies: companies } };
};

export default function CompaniesPage({ initialCompanies }: { initialCompanies: Company[] }) {
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  async function refresh() {
    // full=1 + no paging → full company rows as a single list (page does its own search/filter)
    const res = await fetch("/api/companies?full=1");
    const data = await res.json();
    setCompanies(data.companies ?? data);
  }

  function openCreate() {
    setEditId(null);
    setForm(BLANK_FORM);
    setShowModal(true);
  }

  function openEdit(c: Company) {
    setEditId(c.id);
    setForm({
      name: c.name,
      domain: c.domain ?? "",
      industry: c.industry ?? "",
      location: c.location ?? "",
      linkedin_url: c.linkedin_url ?? "",
      website: c.website ?? "",
      notes: c.notes ?? "",
    });
    setShowModal(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const body = {
      name: form.name,
      domain: form.domain || null,
      industry: form.industry || null,
      location: form.location || null,
      linkedin_url: form.linkedin_url || null,
      website: form.website || null,
      notes: form.notes || null,
    };
    const res = editId
      ? await fetch(`/api/companies/${editId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setLoading(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed"); return; }
    toast.success(editId ? "Company updated" : "Company created");
    setShowModal(false);
    refresh();
  }

  async function deleteCompany(id: string) {
    if (!confirm("Delete this company? Contacts will be unlinked but not deleted.")) return;
    await fetch(`/api/companies/${id}`, { method: "DELETE" });
    toast.success("Deleted");
    setCompanies((prev) => prev.filter((c) => c.id !== id));
  }

  const filtered = companies.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.domain ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <Head>
        <title>Companies — Linki</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">Companies</h1>
            <p className="text-base-content/50 text-sm mt-0.5">Organisations associated with your contacts</p>
          </div>
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors"
            onClick={openCreate}
          >
            <RiAddLine size={15} /> Add Company
          </button>
        </div>

        <div className="mb-4">
          <input
            className="input input-bordered input-sm w-72 bg-base-300/50"
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-base-content/40 text-sm">
            {search ? "No companies match your search." : "No companies yet."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-base-300/50">
            <table className="table w-full text-sm">
              <thead>
                <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                  <th>Name</th>
                  <th>Domain</th>
                  <th>Industry</th>
                  <th>Location</th>
                  <th>Contacts</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-base-300/30 hover:bg-base-200/50">
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md bg-base-300 flex items-center justify-center shrink-0">
                          <RiBuildingLine size={12} className="text-base-content/40" />
                        </span>
                        <Link href={`/companies/${c.id}`} className="font-medium hover:text-primary transition-colors cursor-pointer">
                          {c.name}
                        </Link>
                      </div>
                    </td>
                    <td className="text-base-content/50 text-xs">
                      {c.domain ? (
                        <span className="inline-flex items-center gap-1">
                          <RiGlobalLine size={11} /> {c.domain}
                        </span>
                      ) : <span className="text-base-content/25">—</span>}
                    </td>
                    <td className="text-base-content/60 text-xs">{c.industry ?? <span className="text-base-content/25">—</span>}</td>
                    <td className="text-base-content/60 text-xs">{c.location ?? <span className="text-base-content/25">—</span>}</td>
                    <td className="text-base-content/60 text-xs">{c.contact_count}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button
                          className="inline-flex items-center px-2 py-1 rounded-md text-xs text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors"
                          onClick={() => openEdit(c)}
                        >
                          Edit
                        </button>
                        <button
                          className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                          onClick={() => deleteCompany(c.id)}
                        >
                          <RiDeleteBinLine size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showModal && (
          <div className="modal modal-open">
            <div className="modal-box bg-base-200 border border-base-300/50 max-w-md">
              <h3 className="font-semibold text-base mb-4">{editId ? "Edit Company" : "Add Company"}</h3>
              <form onSubmit={submit} className="flex flex-col gap-3">
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Company name <span className="text-error">*</span></label>
                  <input className="input input-bordered input-sm w-full bg-base-300/50" placeholder="Acme Inc." value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Domain</label>
                    <input className="input input-bordered input-sm w-full bg-base-300/50" placeholder="acme.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Industry</label>
                    <input className="input input-bordered input-sm w-full bg-base-300/50" placeholder="SaaS" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Location</label>
                    <input className="input input-bordered input-sm w-full bg-base-300/50" placeholder="Berlin, Germany" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Website</label>
                    <input className="input input-bordered input-sm w-full bg-base-300/50" placeholder="https://acme.com" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">LinkedIn URL</label>
                  <input className="input input-bordered input-sm w-full bg-base-300/50" placeholder="https://linkedin.com/company/acme" value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Notes</label>
                  <textarea className="textarea textarea-bordered w-full bg-base-300/50 text-sm h-20 resize-none" placeholder="Any notes..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <div className="modal-action mt-1">
                  <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading}>
                    {loading ? <span className="loading loading-spinner loading-xs" /> : (editId ? "Save Changes" : "Add Company")}
                  </button>
                </div>
              </form>
            </div>
            <div className="modal-backdrop" onClick={() => setShowModal(false)} />
          </div>
        )}
      </div>
    </>
  );
}
