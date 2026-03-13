import type { BrowserContext } from "playwright";
import { getDb } from "@/lib/db";

const INBOX_POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const CONVERSATIONS_TO_FETCH = 20;

interface ConversationParticipant {
  entityUrn?: string;
  "com.linkedin.voyager.messaging.MessagingMember"?: {
    miniProfile?: {
      entityUrn?: string; // urn:li:member:12345
      publicIdentifier?: string;
    };
  };
}

interface Conversation {
  entityUrn?: string;
  lastActivityAt?: number; // epoch ms
  unreadCount?: number;
  participants?: ConversationParticipant[];
  "*events"?: string[];
}

interface ConversationEvent {
  eventContent?: {
    "com.linkedin.voyager.messaging.event.MessageEvent"?: {
      attributedBody?: { text?: string };
    };
  };
  from?: {
    "com.linkedin.voyager.messaging.MessagingMember"?: {
      miniProfile?: { entityUrn?: string };
    };
  };
  createdAt?: number;
}

interface InboxResponse {
  elements?: Conversation[];
  included?: unknown[];
}

/**
 * Checks if the inbox needs syncing for this account (15-min interval).
 */
export function shouldSyncInbox(accountId: string): boolean {
  const db = getDb();
  const account = db.prepare("SELECT inbox_synced_at FROM accounts WHERE id = ?").get(accountId) as
    | { inbox_synced_at: string | null }
    | undefined;
  if (!account?.inbox_synced_at) return true;
  const lastSync = new Date(account.inbox_synced_at).getTime();
  return Date.now() - lastSync >= INBOX_POLL_INTERVAL_MS;
}

/**
 * Polls LinkedIn inbox via Voyager API to detect replies from leads.
 * Updates targets.last_replied_at for any lead who sent us a message after we messaged them.
 * Uses a lightweight fetch of the last N conversations — no mark-as-read.
 */
export async function syncAccountInbox(ctx: BrowserContext, accountId: string): Promise<number> {
  const db = getDb();

  // Get our own member URN so we can tell apart "we sent" vs "they replied"
  const account = db.prepare("SELECT inbox_synced_at FROM accounts WHERE id = ?").get(accountId) as
    | { inbox_synced_at: string | null }
    | undefined;

  const lastSyncMs = account?.inbox_synced_at
    ? new Date(account.inbox_synced_at).getTime()
    : 0;

  // Use existing page context — create a temp page to make the API call
  const page = await ctx.newPage();
  let repliesFound = 0;

  try {
    // Navigate to linkedin.com to ensure cookies are active
    await page.goto("https://www.linkedin.com/messaging/", { waitUntil: "domcontentloaded", timeout: 20000 });

    const cookies = await ctx.cookies();
    const jsessionid = cookies.find((c) => c.name === "JSESSIONID")?.value?.replace(/"/g, "") ?? "";
    if (!jsessionid) {
      console.warn(`[inbox] No JSESSIONID for account ${accountId} — skipping`);
      return 0;
    }

    // Fetch recent conversations
    const inboxUrl = `https://www.linkedin.com/voyager/api/messaging/conversations?q=type&type=INBOX&count=${CONVERSATIONS_TO_FETCH}`;
    const rawResponse = await page.evaluate(
      async ({ url, csrf }: { url: string; csrf: string }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const r = await fetch(url, {
            headers: {
              accept: "application/vnd.linkedin.normalized+json+2.1",
              "csrf-token": csrf,
              "x-restli-protocol-version": "2.0.0",
            },
            credentials: "include",
            signal: controller.signal,
          });
          return r.text();
        } finally {
          clearTimeout(timer);
        }
      },
      { url: inboxUrl, csrf: jsessionid }
    );

    let inbox: InboxResponse;
    try {
      inbox = JSON.parse(rawResponse);
    } catch {
      console.warn("[inbox] Failed to parse inbox response");
      return 0;
    }

    const conversations = inbox.elements ?? [];

    for (const conv of conversations) {
      // Only process conversations that changed since last sync
      const lastActivity = conv.lastActivityAt ?? 0;
      if (lastActivity <= lastSyncMs) continue;

      // Extract participant member URNs (skip our own — we'll detect by checking sender on events)
      const participantUrns: string[] = [];
      for (const p of conv.participants ?? []) {
        const member = p["com.linkedin.voyager.messaging.MessagingMember"];
        const urn = member?.miniProfile?.entityUrn; // urn:li:member:12345
        if (urn) participantUrns.push(urn);
      }

      if (participantUrns.length === 0) continue;

      // Fetch the last few events in this conversation to check sender
      const convId = conv.entityUrn?.split(":").pop();
      if (!convId) continue;

      const eventsUrl = `https://www.linkedin.com/voyager/api/messaging/conversations/${convId}/events?count=5`;
      const eventsRaw = await page.evaluate(
        async ({ url, csrf }: { url: string; csrf: string }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          try {
            const r = await fetch(url, {
              headers: {
                accept: "application/vnd.linkedin.normalized+json+2.1",
                "csrf-token": csrf,
                "x-restli-protocol-version": "2.0.0",
              },
              credentials: "include",
              signal: controller.signal,
            });
            return r.text();
          } finally {
            clearTimeout(timer);
          }
        },
        { url: eventsUrl, csrf: jsessionid }
      );

      let events: { elements?: ConversationEvent[] };
      try {
        events = JSON.parse(eventsRaw);
      } catch {
        continue;
      }

      const latestEvent = events.elements?.[0];
      if (!latestEvent) continue;

      // Determine if the last message was sent by them (not us)
      const senderUrn = latestEvent.from?.["com.linkedin.voyager.messaging.MessagingMember"]?.miniProfile?.entityUrn;
      const eventTime = latestEvent.createdAt ?? 0;

      // If we have no sender URN, we can't tell — skip
      if (!senderUrn) continue;

      // Check if any participant (excluding self) matches a known target
      for (const memberUrn of participantUrns) {
        // If the sender is this participant, they replied to us
        if (senderUrn !== memberUrn) continue; // sender was us, not them

        // Match to a target
        const target = db.prepare("SELECT id, message_sent_at, last_replied_at FROM targets WHERE linkedin_member_urn = ?")
          .get(memberUrn) as { id: number; message_sent_at: string | null; last_replied_at: string | null } | undefined;

        if (!target) continue;
        if (target.last_replied_at) continue; // already marked

        // Only count as reply if it happened after we messaged them
        const messagedAt = target.message_sent_at ? new Date(target.message_sent_at).getTime() : 0;
        if (eventTime > messagedAt) {
          const repliedAt = new Date(eventTime).toISOString();
          db.prepare("UPDATE targets SET last_replied_at = ? WHERE id = ?").run(repliedAt, target.id);
          console.log(`[inbox] Marked reply from target ${target.id} at ${repliedAt}`);
          repliesFound++;
        }
      }
    }
  } catch (err) {
    console.warn(`[inbox] Error syncing account ${accountId}:`, err instanceof Error ? err.message : err);
  } finally {
    await page.close();
    // Always update inbox_synced_at so we don't hammer the API on error
    db.prepare("UPDATE accounts SET inbox_synced_at = datetime('now') WHERE id = ?").run(accountId);
  }

  return repliesFound;
}
