import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string;

  if (req.method === "GET") {
    const account = db
      .prepare("SELECT id, parent_account_id, name, from_email, from_name, reply_to, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, username, imap_username, daily_email_limit, active_hours_start, active_hours_end, timezone, working_days, is_verified, signature, ramp_up_enabled, ramp_start_date, created_at FROM email_accounts WHERE id = ?")
      .get(id);
    if (!account) return res.status(404).json({ error: "not found" });
    return res.json(account);
  }

  if (req.method === "PUT") {
    const existing = db.prepare("SELECT parent_account_id FROM email_accounts WHERE id = ?").get(id) as { parent_account_id: string | null } | undefined;
    if (!existing) return res.status(404).json({ error: "not found" });
    const isSubAccount = !!existing.parent_account_id;

    const {
      name, from_email, from_name, reply_to,
      smtp_host, smtp_port, smtp_secure,
      imap_host, imap_port,
      username, password,
      imap_username, imap_password,
      daily_email_limit,
      active_hours_start, active_hours_end,
      timezone, working_days,
      signature,
      ramp_up_enabled,
      ramp_start_date,
    } = req.body;

    const rampEnabled = ramp_up_enabled != null ? (ramp_up_enabled ? 1 : 0) : null;

    // Build password SET clauses only when provided (don't wipe on partial update)
    const pwClause = password ? "password = ?," : "";
    const imapPwClause = imap_password ? "imap_password = ?," : "";

    const pwParams = password ? [encryptSecret(password)] : [];
    const imapPwParams = imap_password ? [encryptSecret(imap_password)] : [];

    // Sub-accounts inherit SMTP/IMAP from their parent (see the cascade below) —
    // this column block is omitted entirely for them, so a partial/absent body
    // can never touch those columns.
    const credsClause = isSubAccount ? "" : `
        smtp_host = COALESCE(?, smtp_host),
        smtp_port = COALESCE(?, smtp_port), smtp_secure = COALESCE(?, smtp_secure),
        imap_host = ?, imap_port = COALESCE(?, imap_port),
        username = COALESCE(?, username), ${pwClause}
        imap_username = ?, ${imapPwClause}`;
    const credsParams = isSubAccount ? [] : [
      smtp_host ?? null, smtp_port ?? null, smtp_secure ?? null,
      imap_host ?? null, imap_port ?? null,
      username ?? null, ...pwParams,
      imap_username ?? null, ...imapPwParams,
    ];

    db.prepare(`
      UPDATE email_accounts SET
        name = COALESCE(?, name), from_email = COALESCE(?, from_email),
        from_name = ?, reply_to = ?,${credsClause}
        daily_email_limit = COALESCE(?, daily_email_limit),
        active_hours_start = COALESCE(?, active_hours_start),
        active_hours_end = COALESCE(?, active_hours_end),
        timezone = COALESCE(?, timezone), working_days = COALESCE(?, working_days),
        signature = ?, ramp_up_enabled = COALESCE(?, ramp_up_enabled),
        ramp_start_date = COALESCE(?, ramp_start_date)
      WHERE id = ?
    `).run(
      name ?? null, from_email ?? null, from_name ?? null, reply_to ?? null,
      ...credsParams,
      daily_email_limit ?? null,
      active_hours_start ?? null, active_hours_end ?? null,
      timezone ?? null, working_days ?? null,
      signature ?? null, rampEnabled, ramp_start_date ?? null,
      id
    );

    // Parent account: cascade any actual credential change down to every sender
    // grouped under it, so they never drift from what they were created with.
    const credsTouched = !isSubAccount && (
      smtp_host !== undefined || smtp_port !== undefined || smtp_secure !== undefined ||
      imap_host !== undefined || imap_port !== undefined ||
      username !== undefined || password || imap_username !== undefined || imap_password
    );
    if (credsTouched) {
      const parent = db.prepare(`
        SELECT smtp_host, smtp_port, smtp_secure, imap_host, imap_port, username, password, imap_username, imap_password
        FROM email_accounts WHERE id = ?
      `).get(id) as Record<string, unknown>;
      db.prepare(`
        UPDATE email_accounts SET
          smtp_host = ?, smtp_port = ?, smtp_secure = ?,
          imap_host = ?, imap_port = ?, username = ?, password = ?,
          imap_username = ?, imap_password = ?
        WHERE parent_account_id = ?
      `).run(
        parent.smtp_host, parent.smtp_port, parent.smtp_secure,
        parent.imap_host, parent.imap_port, parent.username, parent.password,
        parent.imap_username, parent.imap_password,
        id
      );
    }

    return res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    db.prepare("DELETE FROM email_accounts WHERE id = ?").run(id);
    return res.json({ ok: true });
  }

  res.status(405).end();
}
