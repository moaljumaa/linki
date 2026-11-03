import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { encryptSecret } from "@/lib/crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    // Never return passwords to the client
    const accounts = db
      .prepare(`
        SELECT ea.id, ea.name, ea.from_email, ea.from_name, ea.reply_to, ea.parent_account_id,
               ea.smtp_host, ea.smtp_port, ea.smtp_secure,
               ea.imap_host, ea.imap_port, ea.username, ea.imap_username,
               ea.daily_email_limit, ea.active_hours_start, ea.active_hours_end,
               ea.timezone, ea.working_days, ea.is_verified, ea.signature,
               ea.ramp_up_enabled, ea.ramp_start_date, ea.created_at,
               (SELECT COUNT(DISTINCT rp.run_id) FROM run_profiles rp
                JOIN runs r ON rp.run_id = r.id
                WHERE rp.email_account_id = ea.id
                AND r.status IN ('running', 'paused')) AS active_run_count
        FROM email_accounts ea ORDER BY ea.created_at DESC
      `)
      .all();
    return res.json(accounts);
  }

  if (req.method === "POST") {
    const { parent_account_id, from_email, from_name, reply_to } = req.body;

    if (!from_email) {
      return res.status(400).json({ error: "from_email required" });
    }

    // Sub-account (a "sender"): inherits SMTP/IMAP creds and every setting from its
    // parent — only from_email/from_name/reply_to/name can differ. Keeps the runner
    // untouched: it's still just a normal, independent email_accounts row.
    if (parent_account_id) {
      const parent = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(parent_account_id) as Record<string, unknown> | undefined;
      if (!parent) return res.status(400).json({ error: "parent account not found" });
      if (parent.parent_account_id) return res.status(400).json({ error: "cannot add a sender under another sender" });

      const siblingCount = (
        db.prepare("SELECT COUNT(*) c FROM email_accounts WHERE parent_account_id = ?").get(parent_account_id) as { c: number }
      ).c;
      const name = req.body.name || `${parent.name} ${siblingCount + 2}`;

      const id = randomUUID();
      db.prepare(`
        INSERT INTO email_accounts
          (id, parent_account_id, name, from_email, from_name, reply_to,
           smtp_host, smtp_port, smtp_secure, imap_host, imap_port, username, password,
           imap_username, imap_password, daily_email_limit, active_hours_start, active_hours_end,
           timezone, working_days, signature, ramp_up_enabled, ramp_start_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, parent_account_id, name, from_email, from_name ?? null, reply_to ?? null,
        parent.smtp_host, parent.smtp_port, parent.smtp_secure,
        parent.imap_host, parent.imap_port, parent.username, parent.password,
        parent.imap_username, parent.imap_password,
        parent.daily_email_limit, parent.active_hours_start, parent.active_hours_end,
        parent.timezone, parent.working_days, parent.signature,
        parent.ramp_up_enabled, parent.ramp_start_date
      );

      return res.status(201).json({ id });
    }

    const {
      name,
      smtp_host, smtp_port = 587, smtp_secure = 0,
      imap_host, imap_port = 993,
      username, password,
      imap_username, imap_password,
      daily_email_limit = 50,
      active_hours_start = 9, active_hours_end = 18,
      timezone = "UTC", working_days = "1,2,3,4,5",
      signature,
      ramp_up_enabled = 1,
      ramp_start_date,
    } = req.body;

    if (!name || !smtp_host || !username || !password) {
      return res.status(400).json({ error: "name, from_email, smtp_host, username, password required" });
    }

    const id = randomUUID();
    const resolvedRampStart = ramp_start_date ?? new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO email_accounts
        (id, name, from_email, from_name, reply_to, smtp_host, smtp_port, smtp_secure,
         imap_host, imap_port, username, password,
         imap_username, imap_password,
         daily_email_limit, active_hours_start, active_hours_end, timezone, working_days, signature,
         ramp_up_enabled, ramp_start_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name, from_email, from_name ?? null, reply_to ?? null,
      smtp_host, smtp_port, smtp_secure,
      imap_host ?? null, imap_port,
      username, encryptSecret(password),
      imap_username ?? null, imap_password ? encryptSecret(imap_password) : null,
      daily_email_limit, active_hours_start, active_hours_end, timezone, working_days,
      signature ?? null,
      ramp_up_enabled ? 1 : 0, resolvedRampStart
    );

    return res.status(201).json({ id });
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end();
}
