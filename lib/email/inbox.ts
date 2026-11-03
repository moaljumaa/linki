import Imap from "imap";
import { simpleParser } from "mailparser";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { premium } from "@/lib/premium";
import { decryptSecret } from "@/lib/crypto";

const IMAP_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily — replies only need to unenroll a lead within a day
// Jul 2026 incident: all email accounts became "due" in the same tick and synced
// back-to-back (one 20-account burst ran 3 minutes straight, one account alone took
// 85s), which lined up with NocoDB/n8n healthcheck failures on the shared host. A
// deterministic per-account offset spreads accounts across a window so they drift
// apart over successive cycles instead of staying clustered together forever.
const IMAP_POLL_JITTER_MS = 30 * 60 * 1000; // 30 min
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SCAN_DAYS = 90;
const IMAP_SYNC_TIMEOUT_MS = 3 * 60 * 1000; // hard cap per account sync

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

/** Headers-only fetch of the From address for each uid (chunked), uid -> lowercase address. */
async function fetchFromAddresses(imap: Imap, uids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (let i = 0; i < uids.length; i += 1000) {
    await new Promise<void>((resolve) => {
      const f = imap.fetch(uids.slice(i, i + 1000), { bodies: "HEADER.FIELDS (FROM)", struct: false });
      f.on("message", (msg) => {
        let header = "";
        let uid = 0;
        msg.on("body", (stream) => { stream.on("data", (c: Buffer) => { header += c.toString(); }); });
        msg.once("attributes", (attrs) => { uid = attrs.uid; });
        msg.once("end", () => {
          const addr = header.match(/<([^>]+)>/)?.[1] ?? header.match(/[^\s<>"]+@[^\s<>"]+/)?.[0];
          if (uid && addr) out.set(uid, addr.toLowerCase().trim());
        });
      });
      f.once("error", () => resolve());
      f.once("end", () => resolve());
    });
  }
  return out;
}

/**
 * Opens one IMAP connection, runs a single SINCE search, fetches only the From
 * headers and matches them against leads that were emailed but haven't replied.
 * Bodies are downloaded only for actual replies and bounces (mailer-daemon etc.).
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

  // Leads emailed via this account that haven't replied yet — running campaigns only
  // (leads of paused/finished runs aren't being emailed, so there's nothing to unenroll).
  const pendingTargets = db.prepare(`
    SELECT t.id, t.email, MIN(rt.last_step_at) AS first_sent
    FROM targets t
    JOIN run_profiles rp ON rp.target_id = t.id
    JOIN runs r ON r.id = rp.run_id
    JOIN run_profile_tracks rt ON rt.run_profile_id = rp.id
    WHERE t.email IS NOT NULL
      AND t.email_replied_at IS NULL
      AND (t.email_status IS NULL OR t.email_status != 'invalid') -- NULL = never verified, still a live lead
      AND r.status = 'running'
      AND rt.track = 'email'
      AND rt.state NOT IN ('pending')
      AND rp.email_account_id = ?
    GROUP BY t.id
  `).all(emailAccountId) as { id: string; email: string; first_sent: string | null }[];

  if (pendingTargets.length === 0) {
    db.prepare("UPDATE email_accounts SET inbox_synced_at = datetime('now') WHERE id = ?").run(emailAccountId);
    return { replies: 0, bounces: 0 };
  }

  console.log(`[email-inbox] Checking ${pendingTargets.length} leads via one IMAP SINCE scan`);

  const imapUser = account.imap_username ?? account.username;
  const imapPass = decryptSecret(account.imap_password) ?? decryptSecret(account.password)!;

  // IMAP SINCE is date-only (server-local day) — start a day before the first send.
  const firstSent = pendingTargets.map((t) => t.first_sent).filter((d): d is string => !!d).sort()[0];
  const sinceDate = new Date(Math.min(
    firstSent ? new Date(firstSent.replace(" ", "T") + "Z").getTime() : Date.now() - 30 * DAY_MS,
    Date.now() - DAY_MS,
  ) - DAY_MS);
  const oldest = Date.now() - MAX_SCAN_DAYS * DAY_MS;
  if (sinceDate.getTime() < oldest) sinceDate.setTime(oldest);

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

    // The runner awaits this sync inside its main loop, so a stalled IMAP socket
    // would freeze every campaign (Oct 2026 incident: 5 days of no sends).
    const watchdog = setTimeout(() => {
      console.warn(`[email-inbox] IMAP sync for account ${emailAccountId} timed out — aborting`);
      try { imap.destroy(); } catch { /* ignore */ }
      resolve();
    }, IMAP_SYNC_TIMEOUT_MS);

    const done = () => {
      clearTimeout(watchdog);
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

        // ── Reply detection: ONE date-bounded search + a headers-only FROM fetch,
        // matched locally against the lead set. The old per-lead FROM search scaled with
        // lead count x mailbox size (Gmail, 46k msgs: 0.1-1.6s each, and it stalled).
        const uids: number[] = await new Promise((res) =>
          imap.search([["SINCE", sinceDate]], (e, u) => res(e ? [] : u)));
        const fromByUid = await fetchFromAddresses(imap, uids);

        const leadByEmail = new Map(pendingTargets.map((t) => [t.email.toLowerCase().trim(), t]));
        const latestUidByLead = new Map<string, number>(); // lead email -> newest uid
        const bounceUids: number[] = [];
        for (const [uid, from] of fromByUid) {
          if (isBounce(from)) { bounceUids.push(uid); continue; }
          if (leadByEmail.has(from) && uid > (latestUidByLead.get(from) ?? 0)) latestUidByLead.set(from, uid);
        }

        for (const [email, latestUid] of latestUidByLead) {
          const target = leadByEmail.get(email)!;
          console.log(`[email-inbox] Reply detected for ${target.email} (target ${target.id})`);
          replies++;

          // HARD RULE: any reply unenrolls the lead immediately — before and independent of
          // body capture / classification (which may fail or be absent in open-core).
          db.prepare("UPDATE targets SET email_replied_at = COALESCE(email_replied_at, datetime('now')) WHERE id = ?").run(target.id);
          db.prepare(
            `UPDATE run_profile_tracks SET state = 'skipped', error_message = 'Lead replied', next_step_at = NULL, pending_reply_context = NULL
             WHERE state NOT IN ('completed', 'failed', 'skipped')
               AND run_profile_id IN (SELECT id FROM run_profiles WHERE target_id = ?)`,
          ).run(target.id);

          // Capture the body, then let the classifier+dispatcher decide the action.
          // We no longer eagerly stamp email_replied_at here — the dispatcher does it
          // for skip-buckets (call_task / human_reply / not_interested) but leaves it
          // unset for OOO follow-ups so the runner keeps the contact enrolled.
          // On any failure the contact stays enrolled (safe fallback, plan §3.2).
          try {
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

        // ── Bounce detection: bodies only for mailer-daemon messages in the window ──
        if (bounceUids.length > 0) {
          await new Promise<void>((resFetch) => {
            const fetch = imap.fetch(bounceUids.slice(-200), {
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
