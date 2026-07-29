import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { startHeadlessLogin, submitLoginChallenge, awaitLoginApproval } from "@/lib/linkedin/session";

/**
 * Server-side headless LinkedIn login.
 *   POST { step: "start", email, password }  → begins login (returns authenticated | challenge | error)
 *   POST { step: "verify", code }            → submits the email/SMS verification code
 *   POST { step: "await" }                   → waits for a device/app approval to clear
 *
 * The session is born under the same pinned Chromium fingerprint the runner uses
 * and captures all cookies (incl. httpOnly li_ep_auth_context).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const id = req.query.id as string;
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as
    | { email: string }
    | undefined;
  if (!account) return res.status(404).json({ error: "Account not found" });

  const { step } = req.body as { step?: string };

  try {
    if (step === "verify") {
      const { code } = req.body as { code?: string };
      if (!code?.trim()) return res.status(400).json({ error: "code is required" });
      return res.json(await submitLoginChallenge(id, code.trim()));
    }

    if (step === "await") {
      return res.json(await awaitLoginApproval(id));
    }

    const { email, password } = req.body as { email?: string; password?: string };
    const loginEmail = (email || account.email || "").trim();
    if (!loginEmail || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    return res.json(await startHeadlessLogin(id, loginEmail, password));
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
