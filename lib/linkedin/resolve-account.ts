import type DatabaseType from "better-sqlite3";

type DB = DatabaseType.Database;
export interface ResolvedAccount { id: string; email: string }

/**
 * Resolve which authenticated LinkedIn account to act through for a contact.
 * Order: explicit id → the contact's most recent run assignment → the sole
 * authenticated account. Only ever returns an `is_authenticated = 1` account
 * so callers never drive a dead session.
 */
export function resolveLinkedInAccount(db: DB, targetId: string, explicitId?: string): ResolvedAccount | null {
  const byId = (aid: string) =>
    db.prepare("SELECT id, email FROM accounts WHERE id = ? AND is_authenticated = 1").get(aid) as
      | ResolvedAccount
      | undefined;

  if (explicitId) return byId(explicitId) ?? null;

  const assigned = db.prepare(`
    SELECT r.account_id FROM run_profiles rp
    JOIN runs r ON r.id = rp.run_id
    WHERE rp.target_id = ?
    ORDER BY rp.created_at DESC LIMIT 1
  `).get(targetId) as { account_id: string } | undefined;
  if (assigned?.account_id) {
    const a = byId(assigned.account_id);
    if (a) return a;
  }

  const all = db.prepare("SELECT id, email FROM accounts WHERE is_authenticated = 1").all() as ResolvedAccount[];
  return all.length === 1 ? all[0] : null;
}

/**
 * Resolve an authenticated LinkedIn account when there's no target/contact to
 * anchor the lookup to (e.g. Sales Navigator search, which runs before any
 * lead exists locally). Order: explicit id → the sole authenticated account.
 */
export function resolveAnyAuthenticatedAccount(db: DB, explicitId?: string): ResolvedAccount | null {
  const byId = (aid: string) =>
    db.prepare("SELECT id, email FROM accounts WHERE id = ? AND is_authenticated = 1").get(aid) as
      | ResolvedAccount
      | undefined;

  if (explicitId) return byId(explicitId) ?? null;

  const all = db.prepare("SELECT id, email FROM accounts WHERE is_authenticated = 1").all() as ResolvedAccount[];
  return all.length === 1 ? all[0] : null;
}
