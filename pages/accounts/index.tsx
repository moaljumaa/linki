import Head from "next/head";
import { useState } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { RiAddLine, RiArrowRightSLine, RiShieldKeyholeLine } from "react-icons/ri";

interface Account {
  id: string;
  name: string;
  email: string;
  is_authenticated: number;
  daily_connection_limit: number;
  daily_message_limit: number;
  active_hours_start: number;
  active_hours_end: number;
  created_at: string;
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY created_at DESC").all();
  return { props: { initialAccounts: accounts } };
};

export default function AccountsPage({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", daily_connection_limit: 20, daily_message_limit: 50 });
  const [loading, setLoading] = useState(false);

  const [authModal, setAuthModal] = useState<string | null>(null); // accountId
  const [authForm, setAuthForm] = useState({ li_at: "", document_cookie: "" });
  const [authLoading, setAuthLoading] = useState(false);

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!authModal) return;
    setAuthLoading(true);
    const res = await fetch(`/api/accounts/${authModal}/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authForm),
    });
    setAuthLoading(false);
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error ?? "Authentication failed");
      return;
    }
    toast.success("Account authenticated");
    setAuthModal(null);
    setAuthForm({ li_at: "", document_cookie: "" });
    refresh();
  }

  async function refresh() {
    const res = await fetch("/api/accounts");
    setAccounts(await res.json());
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error ?? "Failed to create account");
      return;
    }
    toast.success("Account created");
    setShowModal(false);
    setForm({ name: "", email: "", daily_connection_limit: 20, daily_message_limit: 50 });
    refresh();
  }

  return (
    <>
    <Head>
      <title>Accounts — Linki</title>
      <meta name="description" content="Manage your LinkedIn accounts used for outreach automation." />
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="text-base-content/50 text-sm mt-0.5">LinkedIn accounts used for automation</p>
        </div>
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors" onClick={() => setShowModal(true)}>
          <RiAddLine size={15} /> Add Account
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-16 text-base-content/40 text-sm">
          No accounts yet. Add one to get started.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-base-300/50">
          <table className="table w-full text-sm">
            <thead>
              <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Conn. / day</th>
                <th>Msg. / day</th>
                <th>Active window</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-base-300/30 hover:bg-base-200/50 cursor-pointer" onClick={() => window.location.href = `/accounts/${a.id}`}>
                  <td className="font-medium">{a.name}</td>
                  <td className="text-base-content/60">{a.email}</td>
                  <td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${a.is_authenticated ? "bg-success/15 text-success" : "bg-base-300 text-base-content/40"}`}>
                      {a.is_authenticated ? "Authenticated" : "Not authenticated"}
                    </span>
                  </td>
                  <td className="text-base-content/60">{a.daily_connection_limit}</td>
                  <td className="text-base-content/60">{a.daily_message_limit}</td>
                  <td className="text-base-content/60 text-xs">
                    {a.active_hours_start ?? 9}:00 – {a.active_hours_end ?? 18}:00
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                        onClick={(e) => { e.stopPropagation(); setAuthModal(a.id); }}
                      >
                        <RiShieldKeyholeLine size={12} /> Authenticate
                      </button>
                      <RiArrowRightSLine size={15} className="text-base-content/30" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {authModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-lg">
            <h3 className="font-semibold text-base mb-1">Authenticate LinkedIn Account</h3>
            <p className="text-xs text-base-content/50 mb-4">Paste your LinkedIn cookies from Chrome DevTools. These are used to run automation on your behalf.</p>

            <div className="bg-base-300/50 rounded-lg p-3 text-xs text-base-content/60 mb-4 space-y-1.5">
              <p className="font-medium text-base-content/80">How to get your cookies:</p>
              <p>1. Open <strong>linkedin.com</strong> in Chrome and make sure you are logged in</p>
              <p>2. Open DevTools → <strong>Application</strong> → <strong>Cookies</strong> → <strong>https://www.linkedin.com</strong></p>
              <p>3. Find <strong>li_at</strong> → double-click the Value cell → copy it → paste below</p>
              <p>4. Open the DevTools <strong>Console</strong> tab → run <code className="bg-base-300 px-1 rounded">document.cookie</code> → copy the output → paste below</p>
            </div>

            <form onSubmit={submitAuth} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">li_at cookie value <span className="text-error">*</span></label>
                <input
                  className="input input-bordered input-sm w-full bg-base-300/50 font-mono text-xs"
                  placeholder="AQEDATxxxxxx..."
                  value={authForm.li_at}
                  onChange={(e) => setAuthForm({ ...authForm, li_at: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">document.cookie output (optional but recommended)</label>
                <textarea
                  className="textarea textarea-bordered w-full bg-base-300/50 font-mono text-xs h-24 resize-none"
                  placeholder={'bcookie="v=2&..."; JSESSIONID="ajax:..."; ...'}
                  value={authForm.document_cookie}
                  onChange={(e) => setAuthForm({ ...authForm, document_cookie: e.target.value })}
                />
              </div>
              <div className="modal-action mt-1">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setAuthModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={authLoading}>
                  {authLoading ? <span className="loading loading-spinner loading-xs" /> : "Save Cookies"}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => setAuthModal(null)} />
        </div>
      )}

      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-md">
            <h3 className="font-semibold text-base mb-4">Add LinkedIn Account</h3>
            <form onSubmit={createAccount} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Display name</label>
                <input
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  placeholder="e.g. Mohammad LinkedIn"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Email</label>
                <input
                  type="email"
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Connections/day</label>
                  <input
                    type="number"
                    className="input input-bordered input-sm w-full bg-base-300/50"
                    value={form.daily_connection_limit}
                    onChange={(e) => setForm({ ...form, daily_connection_limit: Number(e.target.value) })}
                    min={1} max={100}
                  />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Messages/day</label>
                  <input
                    type="number"
                    className="input input-bordered input-sm w-full bg-base-300/50"
                    value={form.daily_message_limit}
                    onChange={(e) => setForm({ ...form, daily_message_limit: Number(e.target.value) })}
                    min={1} max={200}
                  />
                </div>
              </div>
              <div className="modal-action mt-2">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : "Add Account"}
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
