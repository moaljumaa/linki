import type { NextApiRequest, NextApiResponse } from "next";
import Imap from "imap";
import { simpleParser } from "mailparser";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";

export interface EmailMessage {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
  html: string | null;
  messageId: string | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const { targetId, emailAccountId } = req.query as { targetId?: string; emailAccountId?: string };
  if (!targetId || !emailAccountId) return res.status(400).json({ error: "targetId and emailAccountId required" });

  const db = getDb();

  const target = db.prepare("SELECT email FROM targets WHERE id = ?").get(targetId) as { email: string | null } | undefined;
  if (!target?.email) return res.status(404).json({ error: "Target has no email" });

  const account = db.prepare(
    "SELECT imap_host, imap_port, username, password, imap_username, imap_password FROM email_accounts WHERE id = ?"
  ).get(emailAccountId) as {
    imap_host: string | null; imap_port: number | null;
    username: string; password: string;
    imap_username: string | null; imap_password: string | null;
  } | undefined;

  if (!account?.imap_host) return res.status(404).json({ error: "Email account not found or missing IMAP config" });

  const imapUser = account.imap_username ?? account.username;
  const imapPass = decryptSecret(account.imap_password) ?? decryptSecret(account.password)!;
  const targetEmail = target.email.toLowerCase();

  try {
    const messages = await fetchThread(
      { host: account.imap_host, port: account.imap_port ?? 993, user: imapUser, password: imapPass },
      targetEmail
    );
    return res.json({ messages });
  } catch (err) {
    console.error("[inbox/thread] IMAP error:", err);
    return res.status(500).json({ error: "IMAP fetch failed" });
  }
}

interface ImapConfig { host: string; port: number; user: string; password: string; }

async function fetchThread(cfg: ImapConfig, contactEmail: string): Promise<EmailMessage[]> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      host: cfg.host,
      port: cfg.port,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      user: cfg.user,
      password: cfg.password,
      authTimeout: 10_000,
      connTimeout: 12_000,
    });

    const done = (err?: Error) => {
      try { imap.end(); } catch { /* ignore */ }
      if (err) reject(err);
    };

    const messages: EmailMessage[] = [];

    imap.once("error", (err: Error) => done(err));
    imap.once("ready", () => {
      imap.openBox("INBOX", true, (boxErr) => {
        if (boxErr) { done(boxErr); return; }

        // Search for messages FROM or TO the contact
        imap.search([["OR", ["FROM", contactEmail], ["TO", contactEmail]]], (searchErr, uids) => {
          if (searchErr) { done(searchErr); return; }
          if (uids.length === 0) { resolve([]); done(); return; }

          // Fetch the last 20 matching messages max
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
                      html: parsed.html || null,
                      messageId: parsed.messageId ?? null,
                    });
                  } catch { /* skip malformed */ }
                  res2();
                });
              });

              // Only use msg.end as fallback if no body was received
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
