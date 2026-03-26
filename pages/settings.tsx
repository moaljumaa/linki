import Head from "next/head";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { RiLockPasswordLine, RiShieldCheckLine } from "react-icons/ri";

export default function SettingsPage() {
  const { data: session } = useSession();

  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Failed to change password.");
      return;
    }
    toast.success("Password changed successfully.");
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
  }

  return (
    <>
      <Head>
        <title>Settings — Linki</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="max-w-lg">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-base-content/50 text-sm mt-0.5">Manage your account preferences</p>
        </div>

        {/* Account info */}
        <div className="bg-base-200 border border-base-300/50 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <RiShieldCheckLine size={14} className="text-base-content/40" />
            <span className="text-xs font-medium text-base-content/40 uppercase tracking-wide">Account</span>
          </div>
          <p className="text-sm text-base-content/70">
            Signed in as <span className="text-base-content font-medium">{session?.user?.email ?? "—"}</span>
          </p>
        </div>

        {/* Change password */}
        <div className="bg-base-200 border border-base-300/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <RiLockPasswordLine size={14} className="text-base-content/40" />
            <span className="text-xs font-medium text-base-content/40 uppercase tracking-wide">Change password</span>
          </div>
          <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
            <div>
              <label className="label text-xs text-base-content/50 pb-1">Current password</label>
              <input
                type="password"
                className="input input-bordered input-sm w-full bg-base-300/50"
                placeholder="Your current password"
                value={form.currentPassword}
                onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label text-xs text-base-content/50 pb-1">New password</label>
              <input
                type="password"
                className="input input-bordered input-sm w-full bg-base-300/50"
                placeholder="Min. 8 characters"
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                minLength={8}
                required
              />
            </div>
            <div>
              <label className="label text-xs text-base-content/50 pb-1">Confirm new password</label>
              <input
                type="password"
                className="input input-bordered input-sm w-full bg-base-300/50"
                placeholder="Repeat new password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                required
              />
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {loading ? <span className="loading loading-spinner loading-xs" /> : "Update password"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
