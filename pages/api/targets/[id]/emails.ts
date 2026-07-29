import type { NextApiRequest, NextApiResponse } from "next";
import Imap from "imap";
import { simpleParser } from "mailparser";
import { getDb } from "@/lib/db";
import { sendEmail, type EmailAccount } from "@/lib/email/sender";
import { decryptSecret } from "@/lib/crypto";

// Email conversation for one contact, account-resolved automatically so callers (incl. the MCP)
// never need to know the email_account_id.
//   GET  → the IMAP thread (sent + received) with this contact.
//   POST → send an email to this contact as the Linki sending identity (subject optional → reply).
//
// Account resolution order: explicit email_account_id → the contact's most recent run_profile
// assignment → the single configured account if there's exactly one.

type AccountRow = {
  id: string; from_email: string; from_name: string | null; reply_to: string | null;
  smtp_host: string; smtp_port: number; smtp_secure: number;
  imap_host: string | null; imap_port: number | null;
  username: string; password: string;
  imap_username: string | null; imap_password: string | null;
};

function resolveAccount(db: ReturnType<typeof getDb>, targetId: string, explicitId?: string): AccountRow | null {
  const cols = `id, from_email, from_name, reply_to, smtp_host, smtp_port, smtp_secure,
                imap_host, imap_port, username, password, imap_username, imap_password`;
  if (explicitId) {
    return (db.prepare(`SELECT ${cols} FROM email_accounts WHERE id = ?`).get(explicitId) as AccountRow) ?? null;
  }
  const assigned = db.prepare(`
    SELECT rp.email_account_id FROM run_profiles rp
    WHERE rp.target_id = ? AND rp.email_account_id IS NOT NULL
    ORDER BY rp.created_at DESC LIMIT 1
  `).get(targetId) as { email_account_id: string } | undefined;
  if (assigned?.email_account_id) {
    return (db.prepare(`SELECT ${cols} FROM email_accounts WHERE id = ?`).get(assigned.email_account_id) as AccountRow) ?? null;
  }
  const all = db.prepare(`SELECT ${cols} FROM email_accounts`).all() as AccountRow[];
  return all.length === 1 ? all[0] : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const targetId = req.query.id as string;

  const target = db.prepare("SELECT id, email FROM targets WHERE id = ?").get(targetId) as
    | { id: string; email: string | null } | undefined;
  if (!target) return res.status(404).json({ error: "Contact not found" });
  if (!target.email) return res.status(400).json({ error: "Contact has no email address" });

  // ── Read thread ──
  if (req.method === "GET") {
    const account = resolveAccount(db, targetId, req.query.email_account_id as string | undefined);
    if (!account?.imap_host) {
      return res.status(400).json({ error: "No email account with IMAP config could be resolved for this contact" });
    }
    const cfg = {
      host: account.imap_host,
      port: account.imap_port ?? 993,
      user: account.imap_username ?? account.username,
      password: decryptSecret(account.imap_password) ?? decryptSecret(account.password)!,
    };
    // Transient IMAP failures (dropped connection, auth timeout) are common — retry once
    // before surfacing a structured error rather than an opaque 500.
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const messages = await fetchThread(cfg, target.email.toLowerCase());
        return res.json({ email_account_id: account.id, contact_email: target.email, messages });
      } catch (err) {
        lastErr = err;
        console.warn(`[targets/emails] IMAP attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
      }
    }
    return res.status(502).json({
      error: "IMAP fetch failed",
      detail: lastErr instanceof Error ? lastErr.message : String(lastErr),
      email_account_id: account.id,
      mailbox: "INBOX",
      contact_email: target.email,
      hint: "Transient IMAP error after 1 retry. For reliable reply retrieval use get_replies, which reads stored replies and never hits IMAP live.",
    });
  }

  // ── Send / reply ──
  if (req.method === "POST") {
    const { subject, body, email_account_id } = req.body as {
      subject?: string; body?: string; email_account_id?: string;
    };
    if (!body?.trim()) return res.status(400).json({ error: "body is required" });

    const account = resolveAccount(db, targetId, email_account_id);
    if (!account) return res.status(400).json({ error: "No email account could be resolved for this contact" });

    // No subject → treat as a reply: reuse the last subject in the thread (Re: …) or a sane default.
    let finalSubject = subject?.trim();
    if (!finalSubject) {
      const lastReply = db.prepare(
        "SELECT subject FROM email_replies WHERE target_id = ? AND subject IS NOT NULL ORDER BY received_at DESC LIMIT 1"
      ).get(targetId) as { subject: string } | undefined;
      finalSubject = lastReply?.subject
        ? (/^re:/i.test(lastReply.subject) ? lastReply.subject : `Re: ${lastReply.subject}`)
        : "Re:";
    }

    try {
      await sendEmail(
        { ...account, password: decryptSecret(account.password)! } as EmailAccount,
        target.email, finalSubject, body
      );
      return res.json({ ok: true, email_account_id: account.id, to: target.email, subject: finalSubject });
    } catch (err) {
      console.error("[targets/emails] send failed:", err);
      return res.status(500).json({ error: err instanceof Error ? err.message : "Send failed" });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}

interface ImapConfig { host: string; port: number; user: string; password: string; }
interface EmailMessage {
  uid: number; from: string; to: string; subject: string; date: string;
  text: string; messageId: string | null;
}

async function fetchThread(cfg: ImapConfig, contactEmail: string): Promise<EmailMessage[]> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      host: cfg.host, port: cfg.port, tls: true,
      tlsOptions: { rejectUnauthorized: false },
      user: cfg.user, password: cfg.password,
      authTimeout: 10_000, connTimeout: 12_000,
    });
    const done = (err?: Error) => { try { imap.end(); } catch { /* ignore */ } if (err) reject(err); };
    const messages: EmailMessage[] = [];

    imap.once("error", (err: Error) => done(err));
    imap.once("ready", () => {
      imap.openBox("INBOX", true, (boxErr) => {
        if (boxErr) { done(boxErr); return; }
        imap.search([["OR", ["FROM", contactEmail], ["TO", contactEmail]]], (searchErr, uids) => {
          if (searchErr) { done(searchErr); return; }
          if (uids.length === 0) { resolve([]); done(); return; }
          const toFetch = uids.slice(-20);
          const fetch = imap.fetch(toFetch, { bodies: "", struct: false });
          const pending: Promise<void>[] = [];

          fetch.on("message", (msg) => {
            let uid = 0;
            msg.on("attributes", (attrs) => { uid = attrs.uid; });
            const p = new Promise<void>((res2) => {
              const chunks: Buffer[] = [];
              let bodyEnded = false;
              msg.on("body", (stream) => {
                stream.on("data", (c: Buffer) => chunks.push(c));
                stream.once("end", async () => {
                  bodyEnded = true;
                  try {
                    const parsed = await simpleParser(Buffer.concat(chunks));
                    messages.push({
                      uid,
                      from: parsed.from?.text ?? "",
                      to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(a => a.text).join(", ") : parsed.to.text) : "",
                      subject: parsed.subject ?? "(no subject)",
                      date: parsed.date?.toISOString() ?? new Date().toISOString(),
                      text: parsed.text ?? "",
                      messageId: parsed.messageId ?? null,
                    });
                  } catch { /* skip malformed */ }
                  res2();
                });
              });
              msg.once("end", () => { if (!bodyEnded) res2(); });
            });
            pending.push(p);
          });

          fetch.once("error", (fetchErr: Error) => done(fetchErr));
          fetch.once("end", async () => {
            await Promise.allSettled(pending);
            messages.sort((a, b) => a.date.localeCompare(b.date));
            resolve(messages);
            done();
          });
        });
      });
    });
    imap.connect();
  });
}
