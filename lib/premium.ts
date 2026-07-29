// lib/premium.ts — the ONE bridge from open-core code to commercial (ee/) features.
//
// This file lives in open-core and is present in BOTH the private and public builds.
// It loads ee/ if the folder exists, otherwise degrades to `null`. Open-core code must
// call premium features ONLY through the `premium` object exported here — never with a
// direct `import ... from "@/ee/..."` anywhere else. That one rule is what makes the
// public build (ee/ stripped) compile and run with premium cleanly absent.
//
// Full strategy + rules: docs/OPEN_CORE.md
//
// IMPORTANT: the surface type below is declared HERE, in open-core, on purpose. If we
// imported the type from @/ee, the public build (where @/ee does not exist) would fail
// to typecheck. ee/index.ts must SATISFY this type instead. Extend this as features land.

// Minimal structural shapes for what OPEN-CORE consumes from premium features. These are
// declared here (not imported from @/ee) so the public build typechecks with ee/ stripped.
// They are intentionally loose at the boundary — ee/ owns the rich domain types and must
// SATISFY these. Only add a field here when open-core actually reads it. Kept deliberately
// permissive (no index signatures) so the richer ee/ return types remain assignable.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AiSurface {
  // Returns at least { default_model } — ee's AgentConfig is a superset.
  getAgentConfig(): { default_model: string | null };
  // Bundle is passed straight back into the writers; open-core never inspects its innards.
  getContactWithCompany(targetId: string): { contact: any; company: any } | null;
  // Writers take a large param object (ee owns its full type); open-core builds it inline.
  writeEmail(params: any): Promise<{ subject: string; body: string }>;
  writeLinkedInMessage(params: any): Promise<{ body: string }>;
  writeSalesInMail(params: any): Promise<{ subject: string; body: string }>;
}

export interface RepliesSurface {
  // AI classify + auto-followup for one stored reply (email or LinkedIn).
  classifyAndDispatch(replyId: string): Promise<void>;
  // LinkedIn inbox sync (reply detection), driven by the runner loop.
  shouldSyncInbox(accountId: string): boolean;
  syncAccountInbox(accountId: string): Promise<number>;
}

export interface InMailSurface {
  // Sends a Sales Nav InMail via a live browser page (playwright Page type is open-core).
  sendInMail(page: any, salesNavUrl: string, subject: string, body: string): Promise<void>;
}

export interface PremiumSurface {
  ai?: AiSurface;
  replies?: RepliesSurface;
  inmail?: InMailSurface;
  [key: string]: unknown;
}

function loadPremium(): PremiumSurface | null {
  try {
    // Loaded by real path. The ee/ folder is imported IN PLACE (not copied) so its own
    // relative imports resolve normally. In the public build this require throws → null.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@/ee");
    return (mod?.default ?? mod) as PremiumSurface;
  } catch {
    return null; // public build: ee/ has been stripped
  }
}

export const premium: PremiumSurface | null = loadPremium();

/** True in the private/commercial build, false in the public open-source build. */
export const hasPremium: boolean = premium !== null;
