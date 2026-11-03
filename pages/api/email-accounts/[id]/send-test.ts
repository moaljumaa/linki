import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { sendEmail } from "@/lib/email/sender";
import { decryptSecret } from "@/lib/crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const id = req.query.id as string;
  const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string };

  if (!to) return res.status(400).json({ error: "to is required" });

  const account = db
    .prepare("SELECT * FROM email_accounts WHERE id = ?")
    .get(id) as {
      id: string; from_email: string; from_name: string | null;
      smtp_host: string; smtp_port: number; smtp_secure: number;
      username: string; password: string; signature: string | null;
    } | undefined;

  if (!account) return res.status(404).json({ error: "not found" });

  const fullBody = buildEmailBody(body ?? "", account.signature);

  try {
    await sendEmail({ ...account, password: decryptSecret(account.password)! }, to, subject ?? "Test email from Linki", fullBody);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

function buildEmailBody(body: string, signature: string | null): string {
  const sig = signature?.trim();
  if (!sig) return body;
  return `${body}\n\n--\n${sig}`;
}
