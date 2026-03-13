import Head from "next/head";
import { useState } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { RiArrowLeftLine, RiShieldCheckLine, RiDeleteBinLine, RiMailLine } from "react-icons/ri";

interface Account {
  id: string;
  name: string;
  email: string;
  is_authenticated: number;
  daily_connection_limit: number;
  daily_message_limit: number;
  active_hours_start: number;
  active_hours_end: number;
  timezone: string;
  working_days: string;
  created_at: string;
}

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

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const db = getDb();
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(params?.id as string);
  if (!account) return { notFound: true };
  return { props: { account } };
};

export default function AccountDetailPage({ account: initial }: { account: Account }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initial.name,
    daily_connection_limit: initial.daily_connection_limit ?? 20,
    daily_message_limit: initial.daily_message_limit ?? 50,
    active_hours_start: initial.active_hours_start ?? 9,
    active_hours_end: initial.active_hours_end ?? 18,
    timezone: initial.timezone || "UTC",
    working_days: initial.working_days || "1,2,3,4,5",
  });

  const activeDays = form.working_days.split(",").map(Number).filter(Boolean);

  function toggleDay(iso: number) {
    const days = activeDays.includes(iso)
      ? activeDays.filter(d => d !== iso)
      : [...activeDays, iso].sort((a, b) => a - b);
    setForm({ ...form, working_days: days.join(",") });
  }

  const [saving, setSaving] = useState(false);
  const [isAuth, setIsAuth] = useState(!!initial.is_authenticated);

  // Email change modal state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [newEmail, setNewEmail] = useState(initial.email);
  const [emailSaving, setEmailSaving] = useState(false);
  const [authing, setAuthing] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.active_hours_start >= form.active_hours_end) {
      toast.error("Active window start must be before end");
      return;
    }
    if (activeDays.length === 0) {
      toast.error("Select at least one working day");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/accounts/${initial.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error ?? "Failed to save");
      return;
    }
    toast.success("Settings saved");
  }

  async function saveEmailAndReauth() {
    if (!newEmail || newEmail === initial.email) {
      setShowEmailModal(false);
      return;
    }
    setEmailSaving(true);
    // Save the new email first
    const saveRes = await fetch(`/api/accounts/${initial.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail }),
    });
    if (!saveRes.ok) {
      setEmailSaving(false);
      const err = await saveRes.json();
      toast.error(err.error ?? "Failed to update email");
      return;
    }
    // Trigger re-authentication with the new email
    setAuthing(true);
    const authRes = await fetch(`/api/accounts/${initial.id}/authenticate`, { method: "POST" });
    setAuthing(false);
    setEmailSaving(false);
    setShowEmailModal(false);
    const authData = await authRes.json();
    if (!authRes.ok) toast.error(authData.error ?? "Email saved but authentication failed");
    else { toast.success("Email updated and re-authenticated"); setIsAuth(true); }
  }

  async function authenticate() {
    setAuthing(true);
    const res = await fetch(`/api/accounts/${initial.id}/authenticate`, { method: "POST" });
    setAuthing(false);
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "Authentication failed");
    else { toast.success("Authenticated"); setIsAuth(true); }
  }

  async function deleteAccount() {
    if (!confirm("Delete this account? This cannot be undone.")) return;
    await fetch(`/api/accounts/${initial.id}`, { method: "DELETE" });
    toast.success("Account deleted");
    router.push("/accounts");
  }

  const invalid = form.active_hours_start >= form.active_hours_end || activeDays.length === 0;

  return (
    <>
    <Head>
      <title>{initial.name} — Accounts — Linki</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div className="max-w-xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/accounts" className="text-base-content/40 hover:text-base-content/70 transition-colors">
          <RiArrowLeftLine size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{initial.name}</h1>
          <p className="text-base-content/50 text-sm mt-0.5">{initial.email}</p>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${isAuth ? "bg-success/15 text-success" : "bg-base-300 text-base-content/40"}`}>
          {isAuth ? "Authenticated" : "Not authenticated"}
        </span>
      </div>

      <form onSubmit={save} className="flex flex-col gap-5">
        {/* Account */}
        <div className="bg-base-200 rounded-lg border border-base-300/50 p-4 flex flex-col gap-3">
          <h2 className="text-sm font-medium text-base-content/70">Account</h2>
          <div>
            <p className="text-xs text-base-content/50 mb-1">Display name</p>
            <input
              className="input input-bordered input-sm w-full bg-base-300/50"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <p className="text-xs text-base-content/50 mb-1">Email</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-base-300/30 border border-base-300/50 text-sm text-base-content/60">
                <RiMailLine size={13} className="shrink-0" />
                <span className="truncate">{initial.email}</span>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-base-300/60 text-base-content/60 hover:text-base-content hover:bg-base-300 transition-colors"
                onClick={() => { setNewEmail(initial.email); setShowEmailModal(true); }}
              >
                Change
              </button>
            </div>
            <p className="text-xs text-base-content/30 mt-1">Changing email requires re-authentication.</p>
          </div>
        </div>

        {/* Daily limits */}
        <div className="bg-base-200 rounded-lg border border-base-300/50 p-4 flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-medium text-base-content/70">Daily limits</h2>
            <p className="text-xs text-base-content/40 mt-0.5">
              Runner stops sending when these counts are hit for the day. Overflow is rescheduled to a random slot within the next active window.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-base-content/50 mb-1">Connection requests / day</p>
              <input
                type="number"
                className="input input-bordered input-sm w-full bg-base-300/50"
                value={form.daily_connection_limit}
                onChange={(e) => setForm({ ...form, daily_connection_limit: Number(e.target.value) })}
                min={1} max={100}
              />
            </div>
            <div>
              <p className="text-xs text-base-content/50 mb-1">Messages / day</p>
              <input
                type="number"
                className="input input-bordered input-sm w-full bg-base-300/50"
                value={form.daily_message_limit}
                onChange={(e) => setForm({ ...form, daily_message_limit: Number(e.target.value) })}
                min={1} max={200}
              />
            </div>
          </div>
        </div>

        {/* Active window */}
        <div className="bg-base-200 rounded-lg border border-base-300/50 p-4 flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-medium text-base-content/70">Active window</h2>
            <p className="text-xs text-base-content/40 mt-0.5">
              Actions are spread at random times within this window each day.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-base-content/50 mb-1">Start</p>
              <select
                className="select select-sm w-full"
                value={form.active_hours_start}
                onChange={(e) => setForm({ ...form, active_hours_start: Number(e.target.value) })}
              >
                {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
              </select>
            </div>
            <div>
              <p className="text-xs text-base-content/50 mb-1">End</p>
              <select
                className="select select-sm w-full"
                value={form.active_hours_end}
                onChange={(e) => setForm({ ...form, active_hours_end: Number(e.target.value) })}
              >
                {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
              </select>
            </div>
          </div>
          {form.active_hours_start >= form.active_hours_end
            ? <p className="text-xs text-error">Start must be before end</p>
            : <p className="text-xs text-base-content/40">{fmtHour(form.active_hours_start)} – {fmtHour(form.active_hours_end)} ({form.active_hours_end - form.active_hours_start}h window)</p>
          }
        </div>

        {/* Schedule */}
        <div className="bg-base-200 rounded-lg border border-base-300/50 p-4 flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-medium text-base-content/70">Schedule</h2>
            <p className="text-xs text-base-content/40 mt-0.5">
              Connection requests and messages are only sent on these days within the active window. All times use the selected timezone.
            </p>
          </div>
          <div>
            <p className="text-xs text-base-content/50 mb-1">Timezone</p>
            <select
              className="select select-sm w-full"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs text-base-content/50 mb-2">Working days</p>
            <div className="flex gap-1.5">
              {WEEKDAYS.map(day => {
                const active = activeDays.includes(day.iso);
                return (
                  <button
                    key={day.iso}
                    type="button"
                    onClick={() => toggleDay(day.iso)}
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
            {activeDays.length === 0 && <p className="text-xs text-error mt-1.5">Select at least one day</p>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
            onClick={deleteAccount}
          >
            <RiDeleteBinLine size={14} /> Delete account
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-base-300/60 text-base-content/70 hover:bg-base-300 transition-colors disabled:opacity-50"
              onClick={authenticate}
              disabled={authing}
            >
              {authing ? <span className="loading loading-spinner loading-xs" /> : <RiShieldCheckLine size={14} />}
              {isAuth ? "Re-authenticate" : "Authenticate"}
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50"
              disabled={saving || invalid}
            >
              {saving ? <span className="loading loading-spinner loading-xs" /> : "Save settings"}
            </button>
          </div>
        </div>
      </form>

      {/* Email change modal */}
      {showEmailModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-sm">
            <h3 className="font-semibold text-base mb-1">Change email address</h3>
            <p className="text-xs text-base-content/50 mb-4">
              Changing the email will immediately trigger a re-authentication flow to log in with the new address. Make sure the new email is correct before continuing.
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs text-base-content/50 mb-1">New email</p>
                <input
                  type="email"
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  autoFocus
                />
              </div>
              {newEmail === initial.email && (
                <p className="text-xs text-base-content/40">No change from current email.</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors"
                onClick={() => setShowEmailModal(false)}
                disabled={emailSaving || authing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50"
                onClick={saveEmailAndReauth}
                disabled={!newEmail || emailSaving || authing}
              >
                {(emailSaving || authing) ? <span className="loading loading-spinner loading-xs" /> : <RiShieldCheckLine size={14} />}
                {authing ? "Authenticating…" : emailSaving ? "Saving…" : "Save & re-authenticate"}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => { if (!emailSaving && !authing) setShowEmailModal(false); }} />
        </div>
      )}
    </div>
    </>
  );
}
