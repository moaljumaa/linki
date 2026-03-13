import Head from "next/head";
import { useState } from "react";
import { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { RiAddLine, RiDeleteBinLine, RiEditLine } from "react-icons/ri";

interface Template {
  id: number;
  name: string;
  body: string;
  created_at: string;
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const templates = db.prepare("SELECT * FROM templates ORDER BY created_at DESC").all();
  return { props: { initialTemplates: templates } };
};

const EMPTY_FORM = { name: "", body: "" };

export default function TemplatesPage({ initialTemplates }: { initialTemplates: Template[] }) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const res = await fetch("/api/templates");
    setTemplates(await res.json());
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setForm({ name: t.name, body: t.body });
    setShowModal(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const url = editing ? `/api/templates/${editing.id}` : "/api/templates";
    const method = editing ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Failed to save template"); return; }
    toast.success(editing ? "Template updated" : "Template created");
    setShowModal(false);
    refresh();
  }

  async function deleteTemplate(id: number) {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    toast.success("Deleted");
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <>
    <Head>
      <title>Templates — Linki</title>
      <meta name="description" content="Manage message templates with dynamic variables for LinkedIn outreach." />
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Templates</h1>
          <p className="text-base-content/50 text-sm mt-0.5">
            Message templates — use <code className="text-primary">{"{{first_name}}"}</code>, <code className="text-primary">{"{{company}}"}</code> as variables
          </p>
        </div>
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors" onClick={openCreate}>
          <RiAddLine size={15} /> New Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-16 text-base-content/40 text-sm">
          No templates yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {templates.map((t) => (
            <div key={t.id} className="bg-base-200 border border-base-300/50 rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{t.name}</p>
                  <p className="text-base-content/50 text-sm mt-1 whitespace-pre-wrap line-clamp-3">{t.body}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="inline-flex items-center p-1.5 rounded-md text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => openEdit(t)}>
                    <RiEditLine size={13} />
                  </button>
                  <button className="inline-flex items-center p-1.5 rounded-md bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors" onClick={() => deleteTemplate(t.id)}>
                    <RiDeleteBinLine size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-lg">
            <h3 className="font-semibold text-base mb-4">
              {editing ? "Edit Template" : "New Template"}
            </h3>
            <form onSubmit={save} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Template name</label>
                <input
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  placeholder="e.g. Connection note"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">
                  Body — use {"{{first_name}}"}, {"{{company}}"}, {"{{title}}"}
                </label>
                <textarea
                  className="textarea textarea-bordered w-full bg-base-300/50 text-sm leading-relaxed"
                  rows={6}
                  placeholder="Hi {{first_name}}, I noticed you're at {{company}}..."
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  required
                />
              </div>
              <div className="modal-action mt-1">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : "Save"}
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
