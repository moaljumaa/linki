import Imap from "imap";
import { simpleParser } from "mailparser";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { premium } from "@/lib/premium";
import { decryptSecret } from "@/lib/crypto";

const IMAP_POLL_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
// Jul 2026 incident: all email accounts became "due" in the same tick and synced
// back-to-back (one 20-account burst ran 3 minutes straight, one account alone took
// 85s), which lined up with NocoDB/n8n healthcheck failures on the shared host. A
// deterministic per-account offset spreads accounts across a window so they drift
// apart over successive cycles instead of staying clustered together forever.
const IMAP_POLL_JITTER_MS = 30 * 60 * 1000; // 30 min

function accountJitterMs(accountId: string): number {
  let h = 0;
  for (let i = 0; i < accountId.length; i++) h = (h * 31 + accountId.charCodeAt(i)) >>> 0;
  return h % IMAP_POLL_JITTER_MS;
}

const BOUNCE_SENDER_PATTERNS = [
  /mailer-daemon@/i,
  /postmaster@/i,
  /mail-delivery-subsystem@/i,
  /delivery-status@/i,
  /amazonses\.com$/i,
];

function extractEmails(text: string): string[] {
  return [...text.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)].map(m => m[0].toLowerCase());
}

function isBounce(fromEmail: string): boolean {
  return BOUNCE_SENDER_PATTERNS.some(p => p.test(fromEmail));
}

function parseHeaderValue(raw: string, field: string): string {
  const regex = new RegExp(`^${field}:[ \\t]*(.+?)(?=\\r?\\n[^\\s]|$)`, "im");
  const m = raw.match(regex);
  if (!m) return "";
  return m[1].replace(/\r?\n[\t ]+/g, " ").trim();
}

interface EmailAccount {
  id: string;
  imap_host: string | null;
  imap_port: number | null;
  username: string;
  password: string;
  imap_username: string | null;
  imap_password: string | null;
  inbox_synced_at: string | null;
}

/**
 * Fetches the body + headers for a given UID and inserts a row into
 * `email_replies` (idempotent — skips if a row with the same target_id +
 * received_at already exists). Best-effort: errors are swallowed by the caller.
 */
export function captureReplyBody(
  imap: Imap,
  db: ReturnType<typeof getDb>,
  targetId: string,
  fromEmail: string,
  uid: number,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    // Fetch the full raw RFC822 message — mailparser handles MIME multipart,
    // base64 / quoted-printable transfer encodings, and charset decoding. The
    // old HEADER+TEXT regex approach stored raw base64 / =XX escapes for the
    // common German auto-reply formats, feeding the classifier garbage.
    const fetch = imap.fetch(uid, { bodies: [""], struct: false });

    const chunks: Buffer[] = [];

    fetch.on("message", (msg) => {
      msg.on("body", (stream) => {
        stream.on("data", (c: Buffer) => chunks.push(c));
      });
    });

    fetch.once("error", () => resolve(null));
    fetch.once("end", () => {
      void (async () => {
        try {
          const raw = Buffer.concat(chunks);
          const parsed = await simpleParser(raw);

          const subject = parsed.subject ?? null;
          const parsedFrom =
            parsed.from?.value?.[0]?.address?.toLowerCase().trim() || fromEmail.toLowerCase();
          const receivedAt = parsed.date ? parsed.date.toISOString() : new Date().toISOString();

          // Prefer decoded plain text; fall back to stripping the HTML part.
          const rawText =
            parsed.text ??
            (parsed.html ? parsed.html.replace(/<[^>]+>/g, " ") : "");
          const bodyText = rawText
            .replace(/\r\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[ \t]{2,}/g, " ")
            .trim()
            .slice(0, 16_000);

          if (!bodyText) { resolve(null); return; }

          // Dedup: skip if we already have a row for this target with the same received_at
          const existing = db.prepare(
            "SELECT id FROM email_replies WHERE target_id = ? AND received_at = ?"
          ).get(targetId, receivedAt) as { id: string } | undefined;

          if (existing) { resolve(null); return; }

          // Look up the most recent active run for this target — the dispatcher needs
          // it to find the email track to reschedule / enroll a substitute into.
          const runRow = db.prepare(
            `SELECT r.id FROM runs r
             JOIN run_profiles rp ON rp.run_id = r.id
             WHERE rp.target_id = ? AND r.status IN ('running', 'paused')
             ORDER BY r.created_at DESC LIMIT 1`
          ).get(targetId) as { id: string } | undefined;

          const replyId = randomUUID();
          db.prepare(
            `INSERT INTO email_replies (id, target_id, run_id, from_email, subject, body_text, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(replyId, targetId, runRow?.id ?? null, parsedFrom, subject, bodyText, receivedAt);
          resolve(replyId);
        } catch (err) {
          console.warn(`[email-inbox] captureReplyBody parse/insert failed:`, err);
          resolve(null);
        }
      })();
    });
  });
}

export function shouldSyncEmailInbox(emailAccountId: string): boolean {
  const db = getDb();
  const account = db
    .prepare("SELECT inbox_synced_at FROM email_accounts WHERE id = ?")
    .get(emailAccountId) as { inbox_synced_at: string | null } | undefined;
  if (!account?.inbox_synced_at) return true;
  const dueAfterMs = IMAP_POLL_INTERVAL_MS + accountJitterMs(emailAccountId);
  return Date.now() - new Date(account.inbox_synced_at).getTime() >= dueAfterMs;
}

/**
 * Opens one IMAP connection, then for each lead that has been emailed but
 * not yet replied, runs a server-side FROM search. Only touches the mailbox
 * index — never downloads message bodies for reply detection.
 *
 * Also scans the last 50 messages for bounces (mailer-daemon etc.).
 */
export async function syncEmailInbox(emailAccountId: string): Promise<{ replies: number; bounces: number }> {
  const db = getDb();

  const account = db
    .prepare("SELECT id, imap_host, imap_port, username, password, imap_username, imap_password, inbox_synced_at FROM email_accounts WHERE id = ?")
    .get(emailAccountId) as EmailAccount | undefined;

  if (!account?.imap_host) {
    console.warn(`[email-inbox] Account ${emailAccountId} has no IMAP config — skipping`);
    return { replies: 0, bounces: 0 };
  }

  // Leads that were emailed via this account and haven't replied yet
  const pendingTargets = db.prepare(`
    SELECT DISTINCT t.id, t.email
    FROM targets t
    JOIN run_profiles rp ON rp.target_id = t.id
    JOIN run_profile_tracks rt ON rt.run_profile_id = rp.id
    WHERE t.email IS NOT NULL
      AND t.email_replied_at IS NULL
      AND t.email_status != 'invalid'
      AND rt.track = 'email'
      AND rt.state NOT IN ('pending')
      AND rp.email_account_id = ?
  `).all(emailAccountId) as { id: string; email: string }[];

  if (pendingTargets.length === 0) {
    db.prepare("UPDATE email_accounts SET inbox_synced_at = datetime('now') WHERE id = ?").run(emailAccountId);
    return { replies: 0, bounces: 0 };
  }

  console.log(`[email-inbox] Checking ${pendingTargets.length} leads via IMAP FROM search`);

  const imapUser = account.imap_username ?? account.username;
  const imapPass = decryptSecret(account.imap_password) ?? decryptSecret(account.password)!;

  let replies = 0;
  let bounces = 0;

  await new Promise<void>((resolve) => {
    const imap = new Imap({
      host: account.imap_host!,
      port: account.imap_port ?? 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      user: imapUser,
      password: imapPass,
      authTimeout: 10_000,
      connTimeout: 12_000,
    });

    const done = () => {
      try { imap.end(); } catch { /* ignore */ }
      resolve();
    };

    imap.once("error", (err: Error) => {
      console.warn(`[email-inbox] IMAP error for account ${emailAccountId}:`, err.message);
      done();
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", true, async (err, box) => {
        if (err || !box) { console.warn("[email-inbox] openBox failed:", err?.message); done(); return; }

        // ── Reply detection: one FROM search per lead ──────────────────────────
        // Run sequentially — the imap library serialises commands over one TCP connection
        for (const target of pendingTargets) {
          await new Promise<void>((resSearch) => {
            imap.search([["FROM", target.email]], async (searchErr, uids) => {
              if (searchErr) { resSearch(); return; }
              if (uids.length > 0) {
                console.log(`[email-inbox] Reply detected for ${target.email} (target ${target.id})`);
                replies++;

                // Capture the body, then let the classifier+dispatcher decide the action.
                // We no longer eagerly stamp email_replied_at here — the dispatcher does it
                // for skip-buckets (call_task / human_reply / not_interested) but leaves it
                // unset for OOO follow-ups so the runner keeps the contact enrolled.
                // On any failure the contact stays enrolled (safe fallback, plan §3.2).
                try {
                  const latestUid = uids[uids.length - 1];
                  const replyId = await captureReplyBody(imap, db, target.id, target.email, latestUid);
                  // The reply is always STORED (open-core). AI classification + auto-followup
                  // is a premium feature — skipped cleanly when ee/ is absent.
                  if (replyId && premium?.replies) {
                    await premium.replies.classifyAndDispatch(replyId);
                  }
                } catch (err) {
                  console.warn(`[email-inbox] Failed to capture/dispatch reply for ${target.email}:`, err);
                }
              }
              resSearch();
            });
          });
        }

        // ── Bounce detection: scan last 50 messages for mailer-daemon ─────────
        if (box.messages.total > 0) {
          const total = box.messages.total;
          const start = Math.max(1, total - 49);
          const range = `${start}:${total}`;

          await new Promise<void>((resFetch) => {
            const fetch = imap.seq.fetch(range, {
              bodies: ["HEADER.FIELDS (FROM TO)", "TEXT"],
              struct: false,
            });

            type RawMsg = { header: string; body: string };
            const msgs: RawMsg[] = [];

            fetch.on("message", (msg) => {
              const entry: RawMsg = { header: "", body: "" };
              msg.on("body", (stream, info) => {
                const chunks: Buffer[] = [];
                stream.on("data", (c: Buffer) => chunks.push(c));
                stream.once("end", () => {
                  const text = Buffer.concat(chunks).toString();
                  if (info.which.startsWith("HEADER")) entry.header = text;
                  else entry.body = text.slice(0, 3000);
                });
              });
              msg.once("end", () => msgs.push(entry));
            });

            fetch.once("error", () => resFetch());
            fetch.once("end", () => {
              for (const msg of msgs) {
                const fromRaw = parseHeaderValue(msg.header, "From");
                const toRaw = parseHeaderValue(msg.header, "To");

                const emailMatch = fromRaw.match(/<([^>]+)>/) ?? fromRaw.match(/([^\s]+@[^\s]+)/);
                const fromEmail = emailMatch?.[1]?.toLowerCase().trim();
                if (!fromEmail || !isBounce(fromEmail)) continue;

                // Also extract Final-Recipient from DSN bodies (SES bounce format)
                const finalRecipient = msg.body.match(/Final-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i)?.[1] ?? "";
                const candidates = extractEmails(msg.body + " " + toRaw + " " + finalRecipient);
                for (const candidate of candidates) {
                  if (BOUNCE_SENDER_PATTERNS.some(p => p.test(candidate))) continue;

                  const target = db
                    .prepare("SELECT id, email_status, company_id FROM targets WHERE lower(email) = ?")
                    .get(candidate) as { id: string; email_status: string | null; company_id: string | null } | undefined;

                  if (!target || target.email_status === "invalid") continue;

                  const note = `Email bounced on ${new Date().toISOString().slice(0, 10)} — marked invalid`;
                  db.prepare(`
                    UPDATE targets SET email_status = 'invalid',
                      notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
                    WHERE id = ?
                  `).run(note, note, target.id);

                  db.prepare(`
                    UPDATE run_profile_tracks SET state = 'skipped', error_message = 'Email bounced — invalid address'
                    WHERE run_profile_id IN (SELECT id FROM run_profiles WHERE target_id = ?)
                    AND state IN ('pending', 'in_progress')
                  `).run(target.id);

                  if (target.company_id) {
                    const companyNote = `Email domain flagged invalid — bounce for ${candidate} on ${new Date().toISOString().slice(0, 10)}`;
                    db.prepare(`
                      UPDATE companies SET email_domain_invalid = 1,
                        notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
                      WHERE id = ?
                    `).run(companyNote, companyNote, target.company_id);

                    const siblings = db.prepare(`
                      SELECT id FROM targets WHERE company_id = ? AND id != ? AND email IS NOT NULL AND email_status != 'invalid'
                    `).all(target.company_id, target.id) as { id: string }[];

                    for (const sibling of siblings) {
                      const sibNote = `Email bounced on ${new Date().toISOString().slice(0, 10)} — marked invalid (domain flagged via company)`;
                      db.prepare(`
                        UPDATE targets SET email_status = 'invalid',
                          notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
                        WHERE id = ?
                      `).run(sibNote, sibNote, sibling.id);
                      db.prepare(`
                        UPDATE run_profile_tracks SET state = 'skipped', error_message = 'Email domain invalid — company flagged'
                        WHERE run_profile_id IN (SELECT id FROM run_profiles WHERE target_id = ?)
                        AND state IN ('pending', 'in_progress')
                      `).run(sibling.id);
                    }

                    if (siblings.length > 0) {
                      console.log(`[email-inbox] Company ${target.company_id} flagged — ${siblings.length} sibling(s) marked invalid`);
                    }
                  }

                  console.log(`[email-inbox] Bounce for ${candidate} (target ${target.id}) — marked invalid`);
                  bounces++;
                  break;
                }
              }
              resFetch();
            });
          });
        }

        done();
      });
    });

    imap.connect();
  });

  db.prepare("UPDATE email_accounts SET inbox_synced_at = datetime('now') WHERE id = ?").run(emailAccountId);
  return { replies, bounces };
}
