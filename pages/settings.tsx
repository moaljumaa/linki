import Head from "next/head";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import {
  RiAddLine, RiDeleteBinLine, RiEditLine, RiMailLine,
  RiShieldCheckLine, RiShieldKeyholeLine, RiSmartphoneLine, RiDownloadLine, RiCheckLine, RiCloseLine,
  RiLockPasswordLine, RiPlugLine,
  RiLinkedinBoxLine, RiMessage2Line, RiSettings3Line, RiFileCopyLine,
  RiLockLine, RiLockUnlockLine, RiFlashlightLine, RiArrowDownSLine, RiCompassLine,
} from "react-icons/ri";
import { ALL_TOUR_PAGES, TOUR_PAGE_LABELS, replayPageTour, type TourPage } from "@/lib/tour";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "linkedin" | "email" | "templates" | "integrations" | "general";

interface LiAccount {
  id: string; name: string; email: string;
  is_authenticated: number;
  daily_connection_limit: number; daily_message_limit: number; daily_inmail_limit: number;
  active_hours_start: number; active_hours_end: number;
  timezone: string; working_days: string;
  created_at: string;
  active_run_count: number;
}

interface EmailAccount {
  id: string; name: string; from_email: string; from_name: string | null; reply_to: string | null;
  smtp_host: string; smtp_port: number; smtp_secure: number;
  imap_host: string | null; imap_port: number; username: string; imap_username: string | null;
  daily_email_limit: number; active_hours_start: number; active_hours_end: number;
  timezone: string; working_days: string;
  is_verified: number; signature: string | null;
  ramp_up_enabled: number; ramp_start_date: string | null;
  created_at: string;
  active_run_count: number;
}

interface Template {
  id: number; name: string; body: string; created_at: string;
}

// ─── Server-side data ─────────────────────────────────────────────────────────

export const getServerSideProps: GetServerSideProps = async ({ query }) => {
  const db = getDb();
  const liAccounts = db
    .prepare(
      `SELECT a.id, a.name, a.email, a.is_authenticated, a.daily_connection_limit, a.daily_message_limit, a.daily_inmail_limit,
              a.active_hours_start, a.active_hours_end, a.timezone, a.working_days, a.created_at,
              (SELECT COUNT(*) FROM runs r WHERE r.account_id = a.id AND r.status IN ('running', 'paused')) AS active_run_count
       FROM accounts a ORDER BY a.created_at DESC`
    )
    .all();
  const emailAccounts = db
    .prepare("SELECT id, name, from_email, from_name, reply_to, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, username, daily_email_limit, active_hours_start, active_hours_end, timezone, working_days, is_verified, signature, ramp_up_enabled, ramp_start_date, created_at FROM email_accounts ORDER BY created_at DESC")
    .all();
  const templates = db.prepare("SELECT * FROM templates ORDER BY created_at DESC").all();
  const validTabs: Tab[] = ["linkedin", "email", "templates", "integrations", "general"];
  const tab: Tab = validTabs.includes(query.tab as Tab) ? (query.tab as Tab) : "linkedin";
  return { props: { liAccounts, emailAccounts, templates, initialTab: tab } };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "linkedin", label: "LinkedIn", icon: RiLinkedinBoxLine },
  { key: "email", label: "Email", icon: RiMailLine },
  { key: "templates", label: "Templates", icon: RiMessage2Line },
  { key: "integrations", label: "Integrations", icon: RiPlugLine },
  { key: "general", label: "General", icon: RiSettings3Line },
];

const PRESET_CONFIGS: Record<string, { smtp_host: string; smtp_port: number; smtp_secure: number; imap_host: string; imap_port: number }> = {
  gmail: { smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_secure: 0, imap_host: "imap.gmail.com", imap_port: 993 },
  outlook: { smtp_host: "smtp-mail.outlook.com", smtp_port: 587, smtp_secure: 0, imap_host: "outlook.office365.com", imap_port: 993 },
  custom: { smtp_host: "", smtp_port: 587, smtp_secure: 0, imap_host: "", imap_port: 993 },
};

const BLANK_EMAIL_FORM = {
  preset: "custom", name: "", from_email: "", from_name: "", reply_to: "",
  smtp_host: "", smtp_port: 587, smtp_secure: 0,
  imap_host: "", imap_port: 993, username: "", password: "",
  imap_username: "", imap_password: "",
  daily_email_limit: 50, active_hours_start: 9, active_hours_end: 18,
  timezone: "Europe/Berlin", working_days: "1,2,3,4,5", signature: "",
  ramp_up_enabled: true,
  ramp_start_date: new Date().toISOString().slice(0, 10),
};

const TIMEZONES = [
  { value: "Pacific/Midway",      label: "UTC−11 — Midway Island" },
  { value: "Pacific/Honolulu",    label: "UTC−10 — Hawaii" },
  { value: "America/Anchorage",   label: "UTC−9  — Alaska" },
  { value: "America/Los_Angeles", label: "UTC−8  — Pacific Time (US)" },
  { value: "America/Denver",      label: "UTC−7  — Mountain Time (US)" },
  { value: "America/Chicago",     label: "UTC−6  — Central Time (US)" },
  { value: "America/New_York",    label: "UTC−5  — Eastern Time (US)" },
  { value: "America/Caracas",     label: "UTC−4  — Caracas, La Paz" },
  { value: "America/Sao_Paulo",   label: "UTC−3  — São Paulo, Buenos Aires" },
  { value: "America/Noronha",     label: "UTC−2  — Mid-Atlantic" },
  { value: "Atlantic/Azores",     label: "UTC−1  — Azores" },
  { value: "UTC",                 label: "UTC+0  — London (no DST)" },
  { value: "Europe/London",       label: "UTC+0/+1 — London (BST)" },
  { value: "Europe/Paris",        label: "UTC+1/+2 — Paris, Berlin, Amsterdam" },
  { value: "Europe/Helsinki",     label: "UTC+2/+3 — Helsinki, Kyiv, Tallinn" },
  { value: "Europe/Moscow",       label: "UTC+3  — Moscow, Istanbul" },
  { value: "Asia/Dubai",          label: "UTC+4  — Dubai, Abu Dhabi" },
  { value: "Asia/Karachi",        label: "UTC+5  — Karachi, Islamabad" },
  { value: "Asia/Kolkata",        label: "UTC+5:30 — India" },
  { value: "Asia/Dhaka",          label: "UTC+6  — Dhaka, Almaty" },
  { value: "Asia/Bangkok",        label: "UTC+7  — Bangkok, Jakarta, Hanoi" },
  { value: "Asia/Shanghai",       label: "UTC+8  — Beijing, Singapore, HK" },
  { value: "Asia/Tokyo",          label: "UTC+9  — Tokyo, Seoul" },
  { value: "Australia/Sydney",    label: "UTC+10/+11 — Sydney" },
  { value: "Pacific/Auckland",    label: "UTC+12/+13 — Auckland" },
];

const WEEKDAYS = [
  { iso: 1, short: "Mon" },
  { iso: 2, short: "Tue" },
  { iso: 3, short: "Wed" },
  { iso: 4, short: "Thu" },
  { iso: 5, short: "Fri" },
  { iso: 6, short: "Sat" },
  { iso: 7, short: "Sun" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function fmtHour(h: number) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

const TEMPLATE_VARS = ["{{first_name}}", "{{last_name}}", "{{company}}", "{{title}}"];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage({
  liAccounts: initialLi,
  emailAccounts: initialEmail,
  templates: initialTemplates,
  initialTab,
}: {
  liAccounts: LiAccount[];
  emailAccounts: EmailAccount[];
  templates: Template[];
  initialTab: Tab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);

  // Open-core: the Integrations tab holds Apollo (free) + OpenRouter/Claude (premium AI)
  // keys. Apollo enrichment is open-core, so the tab is always shown; the premium AI
  // providers inside it are filtered out of the free build (see IntegrationsTab).
  const [hasPremium, setHasPremium] = useState(true);
  useEffect(() => {
    fetch("/api/premium-status").then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setHasPremium(!!d.hasPremium); }).catch(() => {});
  }, []);
  const visibleTabs = TABS;

  function switchTab(t: Tab) {
    setTab(t);
    router.replace(`/settings?tab=${t}`, undefined, { shallow: true });
  }

  return (
    <>
      <Head>
        <title>Settings — Linki</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="max-w-3xl">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-base-content/50 text-sm mt-0.5">Accounts, integrations, and preferences</p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-base-300/50 pb-0">
          {visibleTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              data-tour={`settings-tab-${key}`}
              onClick={() => switchTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors relative -mb-px border-b-2 ${
                tab === key
                  ? "text-base-content border-primary"
                  : "text-base-content/40 border-transparent hover:text-base-content/70"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "linkedin" && <LinkedInTab initialAccounts={initialLi} />}
        {tab === "email" && <EmailTab initialAccounts={initialEmail} />}
        {tab === "templates" && <TemplatesTab initialTemplates={initialTemplates} />}
        {tab === "integrations" && <IntegrationsTab hasPremium={hasPremium} />}
        {tab === "general" && <GeneralTab hasPremium={hasPremium} />}
      </div>
    </>
  );
}

// ─── LinkedIn Tab ─────────────────────────────────────────────────────────────

const BLANK_LI_FORM = {
  name: "", email: "",
  daily_connection_limit: 20, daily_message_limit: 50, daily_inmail_limit: 15,
  active_hours_start: 9, active_hours_end: 18,
  timezone: "Europe/Berlin", working_days: "1,2,3,4,5",
};

function LinkedInTab({ initialAccounts }: { initialAccounts: LiAccount[] }) {
  const [accounts, setAccounts] = useState<LiAccount[]>(initialAccounts);
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<LiAccount | null>(null);
  const [form, setForm] = useState(BLANK_LI_FORM);
  const [loading, setLoading] = useState(false);
  const [authModal, setAuthModal] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "cookies">("login");
  const [authForm, setAuthForm] = useState({ li_at: "", document_cookie: "" });
  const [loginForm, setLoginForm] = useState({ email: "", password: "", code: "" });
  const [loginStage, setLoginStage] = useState<"creds" | "code" | "approve">("creds");
  const [challengeMsg, setChallengeMsg] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  function openAuthModal(account: LiAccount) {
    setAuthModal(account.id);
    setAuthMode("login");
    setLoginStage("creds");
    setChallengeMsg("");
    setLoginForm({ email: account.email ?? "", password: "", code: "" });
    setAuthForm({ li_at: "", document_cookie: "" });
  }

  function closeAuthModal() {
    setAuthModal(null);
    setLoginStage("creds");
    setChallengeMsg("");
    setLoginForm({ email: "", password: "", code: "" });
    setAuthForm({ li_at: "", document_cookie: "" });
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!authModal) return;
    setAuthLoading(true);
    const body =
      loginStage === "creds"
        ? { step: "start", email: loginForm.email, password: loginForm.password }
        : loginStage === "approve"
          ? { step: "await" }
          : { step: "verify", code: loginForm.code };
    const res = await fetch(`/api/accounts/${authModal}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setAuthLoading(false);
    if (!res.ok) { toast.error(data.error ?? "Login failed"); return; }
    if (data.status === "authenticated") {
      toast.success("Logged in successfully");
      closeAuthModal();
      refresh();
    } else if (data.status === "challenge" && data.kind === "captcha") {
      toast.error(data.message);
      setAuthMode("cookies");
    } else if (data.status === "challenge") {
      setChallengeMsg(data.message ?? "");
      if (data.kind === "app") {
        if (loginStage === "approve") toast.error("Still waiting — approve the request in your LinkedIn app, then click Continue.");
        setLoginStage("approve");
      } else {
        setLoginStage("code");
        setLoginForm((f) => ({ ...f, code: "" }));
      }
    } else {
      toast.error(data.message ?? "Login failed");
    }
  }

  async function refresh() {
    const res = await fetch("/api/accounts");
    setAccounts(await res.json());
  }

  function openCreate() {
    setEditingAccount(null);
    setForm(BLANK_LI_FORM);
    setShowModal(true);
  }

  function openEdit(a: LiAccount) {
    setEditingAccount(a);
    setForm({
      name: a.name, email: a.email,
      daily_connection_limit: a.daily_connection_limit,
      daily_message_limit: a.daily_message_limit,
      daily_inmail_limit: a.daily_inmail_limit,
      active_hours_start: a.active_hours_start,
      active_hours_end: a.active_hours_end,
      timezone: a.timezone ?? "Europe/Berlin",
      working_days: a.working_days ?? "1,2,3,4,5",
    });
    setShowModal(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = editingAccount
      ? await fetch(`/api/accounts/${editingAccount.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        })
      : await fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
    setLoading(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed"); return; }
    toast.success(editingAccount ? "Account updated" : "Account created");
    setShowModal(false);
    setEditingAccount(null);
    setForm(BLANK_LI_FORM);
    refresh();
  }

  async function deleteAccount(id: string) {
    if (!confirm("Delete this LinkedIn account?")) return;
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    toast.success("Deleted");
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

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
    if (!res.ok) { toast.error((await res.json()).error ?? "Authentication failed"); return; }
    toast.success("Account authenticated");
    closeAuthModal();
    refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-base-content/50">LinkedIn accounts used for browser automation</p>
        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors"
          onClick={openCreate}
        >
          <RiAddLine size={14} /> Add Account
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-12 text-base-content/30 text-sm border border-dashed border-base-300/60 rounded-xl">
          No LinkedIn accounts yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-4 px-4 py-3 bg-base-200 border border-base-300/50 rounded-xl hover:border-base-300 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-base-300 flex items-center justify-center text-sm font-bold text-base-content/60 shrink-0">
                {a.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-base-content/40">
                  {a.email} · {a.daily_connection_limit} conn/day · {a.daily_message_limit} msg/day · {a.daily_inmail_limit} inmail/day
                  {" · "}{fmtHour(a.active_hours_start ?? 9)}–{fmtHour(a.active_hours_end ?? 18)} ({a.timezone ?? "UTC"})
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {a.active_run_count > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-warning/15 text-warning">
                    <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" /> In use
                  </span>
                ) : null}
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${a.is_authenticated ? "bg-success/15 text-success" : "bg-base-300 text-base-content/40"}`}>
                  {a.is_authenticated ? <><RiCheckLine size={10} /> Auth</> : "Unauth"}
                </span>
                <button
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                  onClick={() => openAuthModal(a)}
                >
                  <RiShieldKeyholeLine size={12} /> Authenticate
                </button>
                <button
                  className="inline-flex items-center p-1.5 rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors"
                  onClick={() => openEdit(a)}
                  title="Edit"
                >
                  <RiEditLine size={14} />
                </button>
                <button
                  className="inline-flex items-center p-1.5 rounded-lg bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                  onClick={() => deleteAccount(a.id)}
                  title="Delete"
                >
                  <RiDeleteBinLine size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit modal */}
      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-md">
            <h3 className="font-semibold text-base mb-4">{editingAccount ? "Edit LinkedIn Account" : "Add LinkedIn Account"}</h3>
            <form onSubmit={save} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Display name</label>
                <input className="input input-bordered input-sm w-full bg-base-300/50" placeholder="e.g. Mohammad LinkedIn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Email</label>
                <input type="email" className="input input-bordered input-sm w-full bg-base-300/50" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Connections/day</label>
                  <input type="number" className="input input-bordered input-sm w-full bg-base-300/50" value={form.daily_connection_limit} onChange={(e) => setForm({ ...form, daily_connection_limit: Number(e.target.value) })} min={1} max={100} />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Messages/day</label>
                  <input type="number" className="input input-bordered input-sm w-full bg-base-300/50" value={form.daily_message_limit} onChange={(e) => setForm({ ...form, daily_message_limit: Number(e.target.value) })} min={1} max={200} />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">InMail/day</label>
                  <input type="number" className="input input-bordered input-sm w-full bg-base-300/50" value={form.daily_inmail_limit} onChange={(e) => setForm({ ...form, daily_inmail_limit: Number(e.target.value) })} min={1} max={100} />
                </div>
              </div>

              <div className="border-t border-base-300/40 pt-3 flex flex-col gap-3">
                <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide">Working Hours</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Start</label>
                    <select className="select select-sm w-full" value={form.active_hours_start} onChange={(e) => setForm({ ...form, active_hours_start: Number(e.target.value) })}>
                      {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">End</label>
                    <select className="select select-sm w-full" value={form.active_hours_end} onChange={(e) => setForm({ ...form, active_hours_end: Number(e.target.value) })}>
                      {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </div>
                </div>
                {form.active_hours_start >= form.active_hours_end
                  ? <p className="text-xs text-error">Start must be before end</p>
                  : <p className="text-xs text-base-content/40">{fmtHour(form.active_hours_start)} – {fmtHour(form.active_hours_end)} ({form.active_hours_end - form.active_hours_start}h window)</p>
                }
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Timezone</label>
                  <select className="select select-sm w-full" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                    {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Working days</label>
                  <div className="flex gap-1.5">
                    {WEEKDAYS.map(day => {
                      const active = form.working_days.split(",").map(Number).includes(day.iso);
                      return (
                        <button
                          key={day.iso}
                          type="button"
                          onClick={() => {
                            const days = active
                              ? form.working_days.split(",").map(Number).filter(d => d !== day.iso)
                              : [...form.working_days.split(",").map(Number), day.iso].sort((a, b) => a - b);
                            setForm({ ...form, working_days: days.join(",") });
                          }}
                          className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                            active
                              ? "bg-primary/20 text-primary border-primary/40"
                              : "bg-base-300/40 text-base-content/40 border-base-300/50 hover:border-base-300"
                          }`}
                        >
                          {day.short}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="modal-action mt-2">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => { setShowModal(false); setEditingAccount(null); }}>Cancel</button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : editingAccount ? "Save Changes" : "Add Account"}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
        </div>
      )}

      {/* Auth modal */}
      {authModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-lg">
            <h3 className="font-semibold text-base mb-1">Authenticate LinkedIn Account</h3>

            {/* Mode toggle */}
            <div className="inline-flex rounded-lg bg-base-300/50 p-0.5 mb-4 mt-2">
              <button
                type="button"
                onClick={() => { setAuthMode("login"); setLoginStage("creds"); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${authMode === "login" ? "bg-primary text-primary-content" : "text-base-content/60 hover:text-base-content"}`}
              >
                Server login
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("cookies")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${authMode === "cookies" ? "bg-primary text-primary-content" : "text-base-content/60 hover:text-base-content"}`}
              >
                Paste cookies
              </button>
            </div>

            {authMode === "login" ? (
              <form onSubmit={submitLogin} className="flex flex-col gap-3">
                <p className="text-xs text-base-content/50 -mt-1">
                  Logs in on the server under the runner&apos;s exact browser fingerprint and captures all cookies. LinkedIn may ask for a code or a device approval.
                </p>
                {loginStage === "creds" ? (
                  <>
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">Email <span className="text-error">*</span></label>
                      <input type="email" autoComplete="off" className="input input-bordered input-sm w-full bg-base-300/50" placeholder="you@example.com" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} required />
                    </div>
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">Password <span className="text-error">*</span></label>
                      <input type="password" autoComplete="off" className="input input-bordered input-sm w-full bg-base-300/50" placeholder="••••••••" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} required />
                    </div>
                  </>
                ) : loginStage === "approve" ? (
                  <div className="bg-info/10 text-info text-xs rounded-lg p-3 flex items-start gap-2">
                    <RiSmartphoneLine size={16} className="shrink-0 mt-0.5" />
                    <span>{challengeMsg || "Approve the sign-in request in your LinkedIn mobile app, then click Continue."}</span>
                  </div>
                ) : (
                  <div>
                    <div className="bg-info/10 text-info text-xs rounded-lg p-3 mb-2">{challengeMsg}</div>
                    <label className="label text-xs text-base-content/50 pb-1">Verification code <span className="text-error">*</span></label>
                    <input inputMode="numeric" autoComplete="one-time-code" className="input input-bordered input-sm w-full bg-base-300/50 font-mono tracking-widest" placeholder="123456" value={loginForm.code} onChange={(e) => setLoginForm({ ...loginForm, code: e.target.value })} required />
                  </div>
                )}
                <div className="modal-action mt-1">
                  <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={closeAuthModal}>Cancel</button>
                  <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={authLoading}>
                    {authLoading ? <span className="loading loading-spinner loading-xs" /> : loginStage === "creds" ? "Log in" : loginStage === "approve" ? "I approved — Continue" : "Verify code"}
                  </button>
                </div>
              </form>
            ) : (
              <>
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
                    <input className="input input-bordered input-sm w-full bg-base-300/50 font-mono text-xs" placeholder="AQEDATxxxxxx..." value={authForm.li_at} onChange={(e) => setAuthForm({ ...authForm, li_at: e.target.value })} required />
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">document.cookie output (optional)</label>
                    <textarea className="textarea textarea-bordered w-full bg-base-300/50 font-mono text-xs h-24 resize-none" placeholder={'bcookie="v=2&..."; JSESSIONID="ajax:..."; ...'} value={authForm.document_cookie} onChange={(e) => setAuthForm({ ...authForm, document_cookie: e.target.value })} />
                  </div>
                  <div className="modal-action mt-1">
                    <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={closeAuthModal}>Cancel</button>
                    <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={authLoading}>
                      {authLoading ? <span className="loading loading-spinner loading-xs" /> : "Save Cookies"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
          <div className="modal-backdrop" onClick={closeAuthModal} />
        </div>
      )}
    </div>
  );
}

// ─── Ramp Diagram ─────────────────────────────────────────────────────────────

function RampDiagram({ startDate, target }: { startDate: string; target: number }) {
  const daysToFull = Math.ceil(target / 2);
  const today = new Date();
  const start = startDate ? new Date(startDate) : today;
  const daysActive = Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86_400_000));
  const currentLimit = Math.min(target, Math.max(2, (daysActive + 1) * 2));
  const fullDate = new Date(start.getTime() + (daysToFull - 1) * 86_400_000);

  // 7 sample points for the bar chart (day 1, day 4, day 7, ... up to full)
  const points: { day: number; val: number }[] = [];
  const step = Math.max(1, Math.floor(daysToFull / 6));
  for (let d = 1; d <= daysToFull; d += step) {
    points.push({ day: d, val: Math.min(target, d * 2) });
  }
  if (points[points.length - 1].day !== daysToFull) {
    points.push({ day: daysToFull, val: target });
  }

  const BAR_MAX_PX = 56; // 14 * 4 = h-14

  return (
    <div className="rounded-lg bg-base-300/40 border border-base-300/60 p-3">
      <div className="flex items-end gap-1 mb-2" style={{ height: BAR_MAX_PX }}>
        {points.map(({ day, val }) => {
          const heightPx = Math.max(3, Math.round((val / target) * BAR_MAX_PX));
          const isPast = daysActive + 1 >= day;
          return (
            <div key={day} className="flex-1 flex items-end">
              <div
                className={`w-full rounded-sm ${isPast ? "bg-primary" : "bg-base-300"}`}
                style={{ height: heightPx }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10px] text-base-content/40">
        <span>Day 1 — 2/day</span>
        <span>Day {daysToFull} — {target}/day</span>
      </div>
      <div className="mt-2 pt-2 border-t border-base-300/50 flex items-center justify-between text-xs">
        <span className="text-base-content/50">
          Today: <span className="text-base-content font-medium">{currentLimit}/day</span>
        </span>
        <span className="text-base-content/40">
          Full volume: {fullDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </span>
      </div>
    </div>
  );
}

// ─── Email Tab ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

function EmailTab({ initialAccounts }: { initialAccounts: EmailAccount[] }) {
  const [accounts, setAccounts] = useState<EmailAccount[]>(initialAccounts);
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null);
  const [form, setForm] = useState(BLANK_EMAIL_FORM);
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  // Separate unlock states for SMTP and IMAP credential sections
  const [smtpUnlocked, setSmtpUnlocked] = useState(false);
  const [imapUnlocked, setImapUnlocked] = useState(false);

  const totalPages = Math.max(1, Math.ceil(accounts.length / PAGE_SIZE));
  const pageAccounts = accounts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function refresh() {
    const res = await fetch("/api/email-accounts");
    const data = await res.json();
    setAccounts(data);
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(data.length / PAGE_SIZE))));
  }

  function openCreate() {
    setEditingAccount(null);
    setForm(BLANK_EMAIL_FORM);
    setSmtpUnlocked(true);
    setImapUnlocked(true);
    setShowModal(true);
  }

  function openDuplicate(a: EmailAccount) {
    setSmtpUnlocked(false);
    setImapUnlocked(false);
    setEditingAccount(null);
    setForm({
      preset: "custom",
      name: `${a.name} (copy)`,
      from_email: a.from_email,
      from_name: a.from_name ?? "",
      reply_to: a.reply_to ?? "",
      smtp_host: a.smtp_host,
      smtp_port: a.smtp_port,
      smtp_secure: a.smtp_secure,
      imap_host: a.imap_host ?? "",
      imap_port: a.imap_port,
      username: a.username,
      password: "",
      imap_username: a.imap_username ?? "",
      imap_password: "",
      daily_email_limit: a.daily_email_limit,
      active_hours_start: a.active_hours_start,
      active_hours_end: a.active_hours_end,
      timezone: a.timezone ?? "UTC",
      working_days: a.working_days ?? "1,2,3,4,5",
      signature: a.signature ?? "",
      ramp_up_enabled: a.ramp_up_enabled === 1,
      ramp_start_date: new Date().toISOString().slice(0, 10),
    });
    setShowModal(true);
  }

  function openEdit(a: EmailAccount) {
    setSmtpUnlocked(false);
    setImapUnlocked(false);
    setEditingAccount(a);
    setForm({
      preset: "custom",
      name: a.name,
      from_email: a.from_email,
      from_name: a.from_name ?? "",
      reply_to: a.reply_to ?? "",
      smtp_host: a.smtp_host,
      smtp_port: a.smtp_port,
      smtp_secure: a.smtp_secure,
      imap_host: a.imap_host ?? "",
      imap_port: a.imap_port,
      username: a.username,
      password: "",
      imap_username: a.imap_username ?? "",
      imap_password: "",
      daily_email_limit: a.daily_email_limit,
      active_hours_start: a.active_hours_start,
      active_hours_end: a.active_hours_end,
      timezone: a.timezone ?? "UTC",
      working_days: a.working_days ?? "1,2,3,4,5",
      signature: a.signature ?? "",
      ramp_up_enabled: a.ramp_up_enabled === 1,
      ramp_start_date: a.ramp_start_date ?? new Date().toISOString().slice(0, 10),
    });
    setShowModal(true);
  }

  function applyPreset(preset: string) {
    const cfg = PRESET_CONFIGS[preset] ?? PRESET_CONFIGS.custom;
    setForm((f) => ({ ...f, preset, ...cfg }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();

    // Uniqueness check for from_email
    const duplicate = accounts.find(
      (a) => a.from_email.toLowerCase() === form.from_email.toLowerCase() &&
             a.id !== editingAccount?.id
    );
    if (duplicate) {
      toast.error(`An account with email ${form.from_email} already exists`);
      return;
    }

    setLoading(true);

    const body: Record<string, unknown> = {
      name: form.name,
      from_email: form.from_email,
      from_name: form.from_name || null,
      reply_to: form.reply_to || null,
      smtp_host: form.smtp_host,
      smtp_port: form.smtp_port,
      smtp_secure: form.smtp_secure,
      imap_host: form.imap_host || null,
      imap_port: form.imap_port,
      username: form.username,
      imap_username: form.imap_username.trim() || null,
      daily_email_limit: form.daily_email_limit,
      active_hours_start: form.active_hours_start,
      active_hours_end: form.active_hours_end,
      timezone: form.timezone,
      working_days: form.working_days,
      signature: form.signature.trim() || null,
      ramp_up_enabled: form.ramp_up_enabled ? 1 : 0,
      ramp_start_date: form.ramp_start_date || new Date().toISOString().slice(0, 10),
    };
    // Only include password if provided (edit mode: leave blank to keep existing)
    if (form.password) body.password = form.password;
    if (form.imap_password) body.imap_password = form.imap_password;

    let res: Response;
    if (editingAccount) {
      res = await fetch(`/api/email-accounts/${editingAccount.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      if (!form.password) { toast.error("SMTP password is required"); setLoading(false); return; }
      res = await fetch("/api/email-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, password: form.password }),
      });
    }

    setLoading(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed"); return; }
    toast.success(editingAccount ? "Account updated" : "Account added");
    setShowModal(false);
    setEditingAccount(null);
    refresh();
  }

  async function testConnection(id: string) {
    setTestingId(id);
    const res = await fetch(`/api/email-accounts/${id}/test`, { method: "POST" });
    setTestingId(null);
    const data = await res.json();
    if (data.smtp?.ok === false) {
      toast.error(`SMTP failed: ${data.smtp.error}`);
    } else {
      toast.success("SMTP verified");
    }
    if (data.imap !== null && data.imap !== undefined) {
      if (data.imap?.ok === false) {
        toast.error(`IMAP failed: ${data.imap.error}`);
      } else {
        toast.success("IMAP verified");
      }
    }
    if (data.ok) refresh();
  }

  async function deleteAccount(id: string) {
    if (!confirm("Delete this email account?")) return;
    await fetch(`/api/email-accounts/${id}`, { method: "DELETE" });
    toast.success("Deleted");
    setAccounts((prev) => {
      const next = prev.filter((a) => a.id !== id);
      setPage((p) => Math.min(p, Math.max(1, Math.ceil(next.length / PAGE_SIZE))));
      return next;
    });
  }

  return (
    <div>
      {/* Gmail/Outlook hint */}
      <div className="bg-info/5 border border-info/20 rounded-xl p-4 mb-5 text-xs text-base-content/60 leading-relaxed">
        <span className="font-medium text-base-content/80">Gmail / Outlook:</span>{" "}
        Enable 2FA, then generate an <strong>App Password</strong> (16-char code) to use here.{" "}
        <span className="text-base-content/40">Gmail: myaccount.google.com/apppasswords · Outlook: account.microsoft.com/security → App passwords</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-base-content/50">SMTP accounts for email outreach</p>
        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors"
          onClick={openCreate}
        >
          <RiAddLine size={14} /> Add Account
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-12 text-base-content/30 text-sm border border-dashed border-base-300/60 rounded-xl">
          No email accounts yet. Add one to start sending emails.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pageAccounts.map((a) => (
            <div key={a.id} className="flex items-center gap-4 px-4 py-3 bg-base-200 border border-base-300/50 rounded-xl hover:border-base-300 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-base-300 flex items-center justify-center text-sm font-bold text-base-content/60 shrink-0">
                {a.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-base-content/40 truncate">{a.from_email} · {a.smtp_host}:{a.smtp_port} · {a.daily_email_limit}/day</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {a.is_verified ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-success/15 text-success">
                    <RiCheckLine size={10} /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-base-300 text-base-content/40">
                    <RiCloseLine size={10} /> Unverified
                  </span>
                )}
                {a.active_run_count > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-warning/15 text-warning">
                    <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" /> In use
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300/50 text-base-content/30">
                    Free
                  </span>
                )}
                <button
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-50"
                  onClick={() => testConnection(a.id)}
                  disabled={testingId === a.id}
                >
                  {testingId === a.id ? <span className="loading loading-spinner loading-xs" /> : <RiShieldCheckLine size={12} />}
                  Test
                </button>
                <button
                  className="inline-flex items-center p-1.5 rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors"
                  onClick={() => openDuplicate(a)}
                  title="Duplicate"
                >
                  <RiFileCopyLine size={14} />
                </button>
                <button
                  className="inline-flex items-center p-1.5 rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors"
                  onClick={() => openEdit(a)}
                >
                  <RiEditLine size={14} />
                </button>
                <button
                  className="inline-flex items-center p-1.5 rounded-lg bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                  onClick={() => deleteAccount(a.id)}
                >
                  <RiDeleteBinLine size={13} />
                </button>
              </div>
            </div>
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-base-300/40">
              <span className="text-xs text-base-content/40">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, accounts.length)} of {accounts.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 rounded-md text-xs text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ←
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`w-6 h-6 rounded-md text-xs font-medium transition-colors ${n === page ? "bg-primary text-primary-content" : "text-base-content/40 hover:text-base-content hover:bg-base-300/50"}`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2.5 py-1 rounded-md text-xs text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-base mb-4">{editingAccount ? "Edit Email Account" : "Add Email Account"}</h3>
            <form onSubmit={save} className="flex flex-col gap-3">

              {/* Preset — only for create */}
              {!editingAccount && (
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Provider preset</label>
                  <div className="flex gap-2">
                    {[["gmail", "Gmail"], ["outlook", "Outlook / Hotmail"], ["custom", "Custom SMTP"]].map(([key, label]) => (
                      <button key={key} type="button" onClick={() => applyPreset(key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${form.preset === key ? "bg-primary/15 text-primary border-primary/30" : "bg-base-300/50 text-base-content/50 border-base-300/50 hover:border-primary/20"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Display name</label>
                  <input className="input input-bordered input-sm w-full bg-base-300/50" placeholder="My Gmail" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">From name (optional)</label>
                  <input className="input input-bordered input-sm w-full bg-base-300/50" placeholder="Your Name" value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">From email address</label>
                  <input type="email" className="input input-bordered input-sm w-full bg-base-300/50" placeholder="you@gmail.com" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} required />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Reply-To (optional)</label>
                  <input type="email" className="input input-bordered input-sm w-full bg-base-300/50" placeholder="you@example.com" value={form.reply_to} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} />
                </div>
              </div>

              <div className="border-t border-base-300/40 pt-3">
                <p className="text-xs font-medium text-base-content/50 mb-2 uppercase tracking-wide">SMTP (sending)</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="label text-xs text-base-content/50 pb-1">Host</label>
                    <input className="input input-bordered input-sm w-full bg-base-300/50 font-mono text-xs" placeholder="smtp.gmail.com" value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} required />
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Port</label>
                    <input type="number" className="input input-bordered input-sm w-full bg-base-300/50" value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2 mb-3">
                  <input type="checkbox" className="checkbox checkbox-xs" checked={form.smtp_secure === 1} onChange={(e) => setForm({ ...form, smtp_secure: e.target.checked ? 1 : 0 })} id="smtp_secure" />
                  <label htmlFor="smtp_secure" className="text-xs text-base-content/60">Use SSL (port 465). Leave unchecked for STARTTLS (port 587).</label>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide">Credentials</p>
                  <button
                    type="button"
                    onClick={() => setSmtpUnlocked((v) => !v)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors"
                  >
                    {smtpUnlocked ? <RiLockUnlockLine size={12} /> : <RiLockLine size={12} />}
                    {smtpUnlocked ? "Lock" : "Unlock to edit"}
                  </button>
                </div>
                {!smtpUnlocked ? (
                  <div className="px-3 py-2.5 rounded-lg bg-base-300/40 border border-base-300/50 text-xs text-base-content/40">
                    {form.username
                      ? <span><span className="text-base-content/60 font-mono">{form.username}</span> · password kept</span>
                      : "Unlock to set username and password"}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">Username / Email</label>
                      <input
                        autoComplete="new-password"
                        className="input input-bordered input-sm w-full bg-base-300/50"
                        placeholder="you@gmail.com"
                        value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">
                        {editingAccount ? "New password (blank = keep)" : "App password"}
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        className="input input-bordered input-sm w-full bg-base-300/50"
                        placeholder={editingAccount ? "•••••••• (unchanged)" : "xxxx xxxx xxxx xxxx"}
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        required={!editingAccount}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-base-300/40 pt-3">
                <p className="text-xs font-medium text-base-content/50 mb-2 uppercase tracking-wide">IMAP (inbox reading — optional)</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="label text-xs text-base-content/50 pb-1">Host</label>
                    <input className="input input-bordered input-sm w-full bg-base-300/50 font-mono text-xs" placeholder="imap.gmail.com" value={form.imap_host} onChange={(e) => setForm({ ...form, imap_host: e.target.value })} />
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Port</label>
                    <input type="number" className="input input-bordered input-sm w-full bg-base-300/50" value={form.imap_port} onChange={(e) => setForm({ ...form, imap_port: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="flex items-center justify-between mb-2 mt-3">
                  <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide">Credentials</p>
                  <button
                    type="button"
                    onClick={() => setImapUnlocked((v) => !v)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors"
                  >
                    {imapUnlocked ? <RiLockUnlockLine size={12} /> : <RiLockLine size={12} />}
                    {imapUnlocked ? "Lock" : "Unlock to edit"}
                  </button>
                </div>
                {!imapUnlocked ? (
                  <div className="px-3 py-2.5 rounded-lg bg-base-300/40 border border-base-300/50 text-xs text-base-content/40">
                    {form.imap_username
                      ? <span><span className="text-base-content/60 font-mono">{form.imap_username}</span> · password kept</span>
                      : <span>Uses SMTP credentials · password kept</span>}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">IMAP username <span className="text-base-content/30">(blank = same as SMTP)</span></label>
                      <input
                        autoComplete="new-password"
                        className="input input-bordered input-sm w-full bg-base-300/50 font-mono text-xs"
                        placeholder="IMAP username"
                        value={form.imap_username}
                        onChange={(e) => setForm({ ...form, imap_username: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">IMAP password <span className="text-base-content/30">(blank = keep)</span></label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        className="input input-bordered input-sm w-full bg-base-300/50"
                        placeholder="•••••••• (unchanged)"
                        value={form.imap_password}
                        onChange={(e) => setForm({ ...form, imap_password: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-base-300/40 pt-3 flex flex-col gap-3">
                <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide">Limits &amp; Schedule</p>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Emails / day</label>
                  <input type="number" className="input input-bordered input-sm w-full bg-base-300/50" value={form.daily_email_limit} onChange={(e) => setForm({ ...form, daily_email_limit: Number(e.target.value) })} min={1} max={500} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Start</label>
                    <select className="select select-sm w-full" value={form.active_hours_start} onChange={(e) => setForm({ ...form, active_hours_start: Number(e.target.value) })}>
                      {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">End</label>
                    <select className="select select-sm w-full" value={form.active_hours_end} onChange={(e) => setForm({ ...form, active_hours_end: Number(e.target.value) })}>
                      {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </div>
                </div>
                {form.active_hours_start >= form.active_hours_end
                  ? <p className="text-xs text-error">Start must be before end</p>
                  : <p className="text-xs text-base-content/40">{fmtHour(form.active_hours_start)} – {fmtHour(form.active_hours_end)} ({form.active_hours_end - form.active_hours_start}h window)</p>
                }
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Timezone</label>
                  <select className="select select-sm w-full" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                    {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Working days</label>
                  <div className="flex gap-1.5">
                    {WEEKDAYS.map(day => {
                      const active = form.working_days.split(",").map(Number).includes(day.iso);
                      return (
                        <button
                          key={day.iso}
                          type="button"
                          onClick={() => {
                            const days = active
                              ? form.working_days.split(",").map(Number).filter(d => d !== day.iso)
                              : [...form.working_days.split(",").map(Number), day.iso].sort((a, b) => a - b);
                            setForm({ ...form, working_days: days.join(",") });
                          }}
                          className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                            active
                              ? "bg-primary/20 text-primary border-primary/40"
                              : "bg-base-300/40 text-base-content/40 border-base-300/50 hover:border-base-300"
                          }`}
                        >
                          {day.short}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="border-t border-base-300/40 pt-3 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide">Sending ramp-up</p>
                    <p className="text-xs text-base-content/35 mt-0.5">Start low, increase +2/day until target volume</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, ramp_up_enabled: !f.ramp_up_enabled }))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.ramp_up_enabled ? "bg-primary" : "bg-base-300"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.ramp_up_enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>

                {form.ramp_up_enabled && (
                  <>
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">Ramp start date</label>
                      <input
                        type="date"
                        className="input input-bordered input-sm w-full bg-base-300/50"
                        value={form.ramp_start_date}
                        onChange={(e) => setForm(f => ({ ...f, ramp_start_date: e.target.value }))}
                      />
                    </div>
                    <RampDiagram startDate={form.ramp_start_date} target={form.daily_email_limit} />
                  </>
                )}
              </div>

              <div className="border-t border-base-300/40 pt-3">
                <p className="text-xs font-medium text-base-content/50 mb-1 uppercase tracking-wide">Signature</p>
                <p className="text-xs text-base-content/35 mb-2">
                  Appended to outgoing emails. If empty, nothing is added — no separator line, nothing.
                </p>
                <textarea
                  className="textarea textarea-bordered w-full bg-base-300/50 text-sm h-24 resize-none font-mono"
                  placeholder={"John Smith\nHead of Sales · Acme Corp\njohn@acme.com"}
                  value={form.signature}
                  onChange={(e) => setForm({ ...form, signature: e.target.value })}
                />
              </div>

              <div className="modal-action mt-1">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => { setShowModal(false); setEditingAccount(null); setSmtpUnlocked(false); setImapUnlocked(false); }}>
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : editingAccount ? "Save changes" : <><RiMailLine size={14} /> Add Account</>}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => { setShowModal(false); setEditingAccount(null); setSmtpUnlocked(false); setImapUnlocked(false); }} />
        </div>
      )}
    </div>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab({ initialTemplates }: { initialTemplates: Template[] }) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({ name: "", body: "" });
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const res = await fetch("/api/templates");
    setTemplates(await res.json());
  }

  function openCreate() { setEditing(null); setForm({ name: "", body: "" }); setShowModal(true); }
  function openEdit(t: Template) { setEditing(t); setForm({ name: t.name, body: t.body }); setShowModal(true); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const url = editing ? `/api/templates/${editing.id}` : "/api/templates";
    const res = await fetch(url, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Failed to save"); return; }
    toast.success(editing ? "Updated" : "Created");
    setShowModal(false);
    refresh();
  }

  async function del(id: number) {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    toast.success("Deleted");
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-base-content/50">
          Use <code className="text-primary text-xs">{"{{first_name}}"}</code>, <code className="text-primary text-xs">{"{{company}}"}</code> as variables
        </p>
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors" onClick={openCreate}>
          <RiAddLine size={14} /> New Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 text-base-content/30 text-sm border border-dashed border-base-300/60 rounded-xl">No templates yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-start gap-4 px-4 py-3 bg-base-200 border border-base-300/50 rounded-xl hover:border-base-300 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-base-content/40 mt-0.5 line-clamp-2 whitespace-pre-wrap">{t.body}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button className="inline-flex items-center p-1.5 rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => openEdit(t)}>
                  <RiEditLine size={14} />
                </button>
                <button className="inline-flex items-center p-1.5 rounded-lg bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors" onClick={() => del(t.id)}>
                  <RiDeleteBinLine size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-lg">
            <h3 className="font-semibold text-base mb-4">{editing ? "Edit Template" : "New Template"}</h3>
            <form onSubmit={save} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Template name</label>
                <input className="input input-bordered input-sm w-full bg-base-300/50" placeholder="e.g. Connection note" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Body</label>
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className="text-xs text-base-content/40">Insert:</span>
                  {TEMPLATE_VARS.map((v) => (
                    <button key={v} type="button"
                      onClick={() => {
                        const el = document.getElementById("tmpl-body") as HTMLTextAreaElement | null;
                        const pos = el?.selectionStart ?? form.body.length;
                        setForm((f) => ({ ...f, body: f.body.slice(0, pos) + v + f.body.slice(pos) }));
                        setTimeout(() => { el?.focus(); el?.setSelectionRange(pos + v.length, pos + v.length); }, 0);
                      }}
                      className="text-xs px-1.5 py-0.5 rounded bg-base-300/60 hover:bg-primary/20 hover:text-primary transition-colors font-mono">
                      {v.replace(/\{\{|\}\}/g, "")}
                    </button>
                  ))}
                </div>
                <textarea id="tmpl-body" className="textarea textarea-bordered w-full bg-base-300/50 text-sm font-mono" rows={6} placeholder="Hi {{first_name}}, I noticed you're at {{company}}..." value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
              </div>
              <div className="modal-action mt-1">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setShowModal(false)}>Cancel</button>
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
  );
}

// ─── Integrations Tab ─────────────────────────────────────────────────────────

interface IntegrationDef {
  key: string;
  name: string;
  description: string;
  badge: string;
  badgeColor: string;
  accentColor: string;
  placeholder: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    key: "apollo",
    name: "Apollo.io",
    description: "Lead enrichment, email reveal & seniority data",
    badge: "Ap",
    badgeColor: "#4f46e5",
    accentColor: "#4f46e5",
    placeholder: "Apollo API key",
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    description: "Route AI requests across models (GPT-4, Claude, Llama…)",
    badge: "OR",
    badgeColor: "#0ea5e9",
    accentColor: "#0ea5e9",
    placeholder: "sk-or-...",
  },
  {
    key: "claude",
    name: "Claude (Anthropic)",
    description: "Anthropic Claude for AI-powered personalization",
    badge: "AI",
    badgeColor: "#d97706",
    accentColor: "#d97706",
    placeholder: "sk-ant-...",
  },
];

// Apollo is open-core (free); OpenRouter/Claude drive the premium AI writer and are
// hidden in the free build.
const PREMIUM_INTEGRATION_KEYS = new Set(["openrouter", "claude"]);

function IntegrationsTab({ hasPremium }: { hasPremium: boolean }) {
  const [configuredMap, setConfiguredMap] = useState<Record<string, { masked: string | null; configured: boolean }>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((rows: { key: string; api_key_masked: string | null; configured: boolean }[]) => {
        const m: Record<string, { masked: string | null; configured: boolean }> = {};
        for (const row of rows) m[row.key] = { masked: row.api_key_masked, configured: row.configured };
        setConfiguredMap(m);
      })
      .catch(() => {});
  }, []);

  async function save(key: string, e: React.FormEvent) {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;
    setSaving(true);
    const res = await fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, api_key: apiKeyInput.trim() }),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to save"); return; }
    const masked = "••••••••" + apiKeyInput.trim().slice(-4);
    setConfiguredMap((m) => ({ ...m, [key]: { masked, configured: true } }));
    setEditingKey(null);
    setApiKeyInput("");
    toast.success("API key saved");
  }

  async function remove(key: string) {
    await fetch(`/api/integrations?key=${key}`, { method: "DELETE" });
    setConfiguredMap((m) => ({ ...m, [key]: { masked: null, configured: false } }));
    toast.success("Integration removed");
  }

  return (
    <div className="flex flex-col gap-3">
      {INTEGRATIONS.filter((intg) => hasPremium || !PREMIUM_INTEGRATION_KEYS.has(intg.key)).map((intg) => {
        const state = configuredMap[intg.key];
        const configured = state?.configured ?? false;
        const isEditing = editingKey === intg.key;

        return (
          <div key={intg.key} className="bg-base-200 border border-base-300/50 rounded-xl overflow-hidden">
            <div className="flex items-center gap-4 px-4 py-3.5">
              {/* Logo badge */}
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ background: intg.badgeColor + "22", color: intg.badgeColor, border: `1px solid ${intg.badgeColor}33` }}
              >
                {intg.badge}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{intg.name}</p>
                  {configured && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-success/15 text-success">
                      <RiCheckLine size={9} /> Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-base-content/40">{intg.description}</p>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {configured && !isEditing && (
                  <>
                    <span className="text-xs text-base-content/25 font-mono">{state?.masked}</span>
                    <button onClick={() => { setEditingKey(intg.key); setApiKeyInput(""); }} className="text-xs text-base-content/40 hover:text-base-content/70 transition-colors px-2 py-1">Change</button>
                    <button onClick={() => remove(intg.key)} className="text-xs text-error/50 hover:text-error transition-colors p-1"><RiCloseLine size={14} /></button>
                  </>
                )}
                {!configured && !isEditing && (
                  <button
                    onClick={() => { setEditingKey(intg.key); setApiKeyInput(""); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-base-300 text-base-content/70 hover:bg-base-300/80 transition-colors"
                  >
                    Configure
                  </button>
                )}
                {isEditing && (
                  <button onClick={() => { setEditingKey(null); setApiKeyInput(""); }} className="text-xs text-base-content/40 hover:text-base-content/70 transition-colors px-1 py-1">
                    <RiCloseLine size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Inline key input */}
            {isEditing && (
              <form onSubmit={(e) => save(intg.key, e)} className="px-4 pb-4 flex gap-2">
                <input
                  type="text"
                  autoFocus
                  className="input input-bordered input-sm flex-1 bg-base-300/50 font-mono text-xs"
                  placeholder={intg.placeholder}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  required
                />
                <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {saving ? <span className="loading loading-spinner loading-xs" /> : "Save"}
                </button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── General Tab ──────────────────────────────────────────────────────────────

// ─── MCP card ─────────────────────────────────────────────────────────────────
// Lets the user grab the hosted MCP URL for this Linki instance (self-hosted, so
// it's built from the browser's own origin) and copy the one-liner to connect an
// AI agent. Premium-only (ee/mcp) — hidden entirely when hasPremium is false.

function McpCard() {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setMcpUrl(`${window.location.origin}/api/mcp`);
    }
  }, []);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can still select the text */
    }
  }

  if (!mcpUrl) return null;

  const cliCommand = `claude mcp add --transport http linki ${mcpUrl}`;

  return (
    <div className="bg-base-200 border border-base-300/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <RiFlashlightLine size={13} className="text-primary shrink-0" />
        <p className="text-xs font-medium text-base-content/40 uppercase tracking-wide">MCP — connect an AI agent</p>
        <RiArrowDownSLine size={15} className={`ml-auto text-base-content/30 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <p className="text-xs text-base-content/50 mb-3 leading-relaxed">
            Connect Claude Code, Claude.ai, Cursor, or any MCP-compatible AI agent to this Linki instance —
            it can read contacts, launch campaigns, and review replies on your behalf.
          </p>

          <div className="rounded-lg border border-base-300/50 bg-base-300/30 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-base-content/40 mb-2">
              MCP server URL
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-md bg-base-100 border border-base-300/50 px-3 py-2 text-xs text-base-content font-mono">
                {mcpUrl}
              </code>
              <button
                onClick={() => copy(mcpUrl)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-base-300/60 px-3 py-2 text-xs text-base-content/70 hover:bg-base-300/60 transition-colors"
              >
                {copied ? <RiCheckLine size={13} className="text-success" /> : <RiFileCopyLine size={13} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className="mt-3 text-xs text-base-content/50 leading-relaxed">
            <p className="mb-1.5"><span className="text-base-content/70 font-medium">Claude Code</span> — run this in your terminal:</p>
            <div className="flex items-center gap-2 mb-1.5">
              <code className="flex-1 min-w-0 truncate rounded-md bg-base-300/30 border border-base-300/50 px-3 py-2 text-xs text-base-content font-mono">
                {cliCommand}
              </code>
              <button
                onClick={() => copy(cliCommand)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-base-300/60 px-3 py-2 text-xs text-base-content/70 hover:bg-base-300/60 transition-colors"
              >
                <RiFileCopyLine size={13} />
              </button>
            </div>
            <p>
              Other agents (Cursor, Claude desktop/web, etc.) — add it as an HTTP MCP server / connector
              using the URL above. You&apos;ll be prompted to sign in to Linki in the browser on first use.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function GeneralTab({ hasPremium }: { hasPremium: boolean }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);
  const [importCap, setImportCap] = useState<number | "">("");
  const [capSaving, setCapSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/import-cap").then((r) => r.json()).then((d) => setImportCap(d.cap ?? 1500)).catch(() => {});
  }, []);

  async function saveImportCap(e: React.FormEvent) {
    e.preventDefault();
    setCapSaving(true);
    const res = await fetch("/api/settings/import-cap", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cap: Number(importCap) }),
    });
    setCapSaving(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed"); return; }
    toast.success("Daily import limit saved");
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) { toast.error("Passwords don't match"); return; }
    setLoading(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
    });
    setLoading(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed"); return; }
    toast.success("Password changed");
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
  }

  return (
    <div className="max-w-sm flex flex-col gap-4">
      {/* Account */}
      <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
        <p className="text-xs font-medium text-base-content/40 uppercase tracking-wide mb-2">Account</p>
        <p className="text-sm text-base-content/70">
          Signed in as <span className="text-base-content font-medium">{session?.user?.email ?? "—"}</span>
        </p>
      </div>

      {/* Daily import limit */}
      <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <RiDownloadLine size={13} className="text-base-content/40" />
          <p className="text-xs font-medium text-base-content/40 uppercase tracking-wide">Daily import limit</p>
        </div>
        <p className="text-xs text-base-content/50 mb-3">
          Max contacts imported from Sales Navigator per day (across all lists). Larger lists are split into batches over consecutive days to stay under LinkedIn&apos;s radar.
        </p>
        <form onSubmit={saveImportCap} className="flex items-end gap-2">
          <div className="flex-1">
            <input type="number" min={1} className="input input-bordered input-sm w-full bg-base-300/50" placeholder="1500" value={importCap} onChange={(e) => setImportCap(e.target.value === "" ? "" : Number(e.target.value))} required />
          </div>
          <button type="submit" disabled={capSaving} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50">
            {capSaving ? <span className="loading loading-spinner loading-xs" /> : "Save"}
          </button>
        </form>
      </div>

      {/* MCP — premium (ee/mcp); hidden in the public build */}
      {hasPremium && <McpCard />}

      {/* Product tour */}
      <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <RiCompassLine size={13} className="text-base-content/40" />
          <p className="text-xs font-medium text-base-content/40 uppercase tracking-wide">Product tour</p>
        </div>
        <p className="text-xs text-base-content/50 mb-3">
          Replay the guided walkthrough for any page.
        </p>
        <select
          className="w-full px-3 py-1.5 rounded-lg text-sm bg-base-300 border border-base-300/80 text-base-content focus:outline-none focus:border-primary/50 cursor-pointer"
          defaultValue=""
          onChange={(e) => {
            const page = e.target.value as TourPage;
            if (!page) return;
            e.target.value = "";
            if (page === "settings") {
              replayPageTour(page);
            } else {
              router.push(page === "dashboard" ? "/" : `/${page}`).then(() => setTimeout(() => replayPageTour(page), 400));
            }
          }}
        >
          <option value="">Select a page to replay…</option>
          {ALL_TOUR_PAGES.map((p) => (
            <option key={p} value={p}>{TOUR_PAGE_LABELS[p]}</option>
          ))}
        </select>
      </div>

      {/* Change password */}
      <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <RiLockPasswordLine size={13} className="text-base-content/40" />
          <p className="text-xs font-medium text-base-content/40 uppercase tracking-wide">Change password</p>
        </div>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
          <div>
            <label className="label text-xs text-base-content/50 pb-1">Current password</label>
            <input type="password" className="input input-bordered input-sm w-full bg-base-300/50" placeholder="Current password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
          </div>
          <div>
            <label className="label text-xs text-base-content/50 pb-1">New password</label>
            <input type="password" className="input input-bordered input-sm w-full bg-base-300/50" placeholder="Min. 8 characters" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} minLength={8} required />
          </div>
          <div>
            <label className="label text-xs text-base-content/50 pb-1">Confirm new password</label>
            <input type="password" className="input input-bordered input-sm w-full bg-base-300/50" placeholder="Repeat new password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required />
          </div>
          <div className="flex justify-end pt-1">
            <button type="submit" disabled={loading} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50">
              {loading ? <span className="loading loading-spinner loading-xs" /> : "Update password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
