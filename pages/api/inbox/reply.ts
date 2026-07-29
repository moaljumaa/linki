import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { sendEmail } from "@/lib/email/sender";
import { decryptSecret } from "@/lib/crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const { emailAccountId, to, subject, body } = req.body as {
    emailAccountId?: string;
    to?: string;
    subject?: string;
    body?: string;
  };

  if (!emailAccountId || !to || !subject || !body) {
    return res.status(400).json({ error: "emailAccountId, to, subject, and body are required" });
  }

  const db = getDb();
  const account = db.prepare(
    "SELECT id, from_email, from_name, reply_to, smtp_host, smtp_port, smtp_secure, username, password FROM email_accounts WHERE id = ?"
  ).get(emailAccountId) as {
    id: string; from_email: string; from_name: string | null; reply_to: string | null;
    smtp_host: string; smtp_port: number; smtp_secure: number; username: string; password: string;
  } | undefined;

  if (!account) return res.status(404).json({ error: "Email account not found" });

  try {
    await sendEmail({ ...account, password: decryptSecret(account.password)! }, to, subject, body);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[inbox/reply] send failed:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Send failed" });
  }
}
