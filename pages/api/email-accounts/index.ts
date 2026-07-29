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
        SELECT ea.id, ea.name, ea.from_email, ea.from_name, ea.reply_to,
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
    const {
      name, from_email, from_name, reply_to,
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

    if (!name || !from_email || !smtp_host || !username || !password) {
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
