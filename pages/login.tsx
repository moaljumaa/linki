import Head from "next/head";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useRouter } from "next/router";
import { useState } from "react";
import { RiLockPasswordLine, RiMailLine, RiKeyLine } from "react-icons/ri";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (res?.ok) {
      router.replace("/");
    } else {
      setError("Incorrect email or password.");
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, inviteCode }),
    });

    const data = await res.json();
    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? "Something went wrong.");
      return;
    }

    // Auto sign in after signup
    const signInRes = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (signInRes?.ok) {
      router.replace("/");
    } else {
      setError("Account created but sign-in failed. Try signing in manually.");
      switchMode("signin");
    }
  }

  return (
    <>
    <Head>
      <title>Sign in — Linki</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div className="min-h-screen bg-base-100 flex items-center justify-center">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <Image src="/logo_linki.png" alt="Linki" width={40} height={40} className="rounded-xl" />
          <div className="text-center">
            <h1 className="text-base-content font-semibold text-lg">Linki</h1>
            <p className="text-base-content/50 text-sm">
              {mode === "signin" ? "Sign in to continue" : "Create your account"}
            </p>
          </div>
        </div>

        {/* Tab toggle */}
        <div className="flex bg-base-300/50 rounded-lg p-1 mb-4">
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className={`flex-1 py-1.5 text-sm rounded-md transition-colors font-medium ${
              mode === "signin"
                ? "bg-base-200 text-base-content shadow-sm"
                : "text-base-content/40 hover:text-base-content/70"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode("signup")}
            className={`flex-1 py-1.5 text-sm rounded-md transition-colors font-medium ${
              mode === "signup"
                ? "bg-base-200 text-base-content shadow-sm"
                : "text-base-content/40 hover:text-base-content/70"
            }`}
          >
            Sign up
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={mode === "signin" ? handleSignIn : handleSignUp}
          className="bg-base-200 border border-base-300/40 rounded-xl p-6 flex flex-col gap-4"
        >
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-base-content/50 font-medium uppercase tracking-wider">Email</label>
            <div className="relative">
              <RiMailLine size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/30" />
              <input
                type="email"
                className="input input-sm w-full pl-8 bg-base-300 border-base-300/50 focus:outline-none focus:border-primary/50"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-base-content/50 font-medium uppercase tracking-wider">Password</label>
            <div className="relative">
              <RiLockPasswordLine size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/30" />
              <input
                type="password"
                className="input input-sm w-full pl-8 bg-base-300 border-base-300/50 focus:outline-none focus:border-primary/50"
                placeholder={mode === "signup" ? "Min. 8 characters" : "Your password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Invite code — signup only */}
          {mode === "signup" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-base-content/50 font-medium uppercase tracking-wider">Invite code</label>
              <div className="relative">
                <RiKeyLine size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/30" />
                <input
                  type="password"
                  className="input input-sm w-full pl-8 bg-base-300 border-base-300/50 focus:outline-none focus:border-primary/50"
                  placeholder="Ask your admin for the invite code"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-error">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-sm w-full"
          >
            {loading
              ? <span className="loading loading-spinner loading-xs" />
              : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
    </>
  );
}
