import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.LINKI_DB_PATH ?? path.join(process.cwd(), "linki.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initDb(db);
    runMigrations(db);
    scheduleOrphanedRunRecovery(db);
  }
  return db;
}

/**
 * On startup, any run marked 'running' in the DB has no active runner
 * (the process died). Re-attach the runner for each orphaned run.
 * Uses setImmediate so DB init completes before the runner tries to use it.
 */
const g = global as typeof global & { __linkiRecoveryDone?: boolean };

function scheduleOrphanedRunRecovery(db: Database.Database) {
  if (g.__linkiRecoveryDone) return;
  g.__linkiRecoveryDone = true;

  const orphaned = db.prepare("SELECT id FROM runs WHERE status = 'running'").all() as { id: string }[];
  if (orphaned.length === 0) return;

  console.log(`[startup] Found ${orphaned.length} orphaned run(s) — resuming:`, orphaned.map(r => r.id));

  setImmediate(async () => {
    const { startRun } = await import("@/lib/linkedin/runner");
    for (const run of orphaned) {
      console.log(`[startup] Resuming run ${run.id}`);
      startRun(run.id).catch(err => {
        console.error(`[startup] Failed to resume run ${run.id}:`, err);
        db.prepare("UPDATE runs SET status = 'failed' WHERE id = ?").run(run.id);
      });
    }
  });
}

function runMigrations(db: Database.Database) {
  // Add columns introduced after initial schema — safe to run on existing DBs
  const migrations = [
    "ALTER TABLE targets ADD COLUMN degree INTEGER",
    "ALTER TABLE targets ADD COLUMN connection_requested_at TEXT",
    "ALTER TABLE targets ADD COLUMN connected_at TEXT",
    "ALTER TABLE targets ADD COLUMN message_sent_at TEXT",
    "ALTER TABLE targets ADD COLUMN last_replied_at TEXT",
    "ALTER TABLE targets ADD COLUMN linkedin_member_urn TEXT",
    "ALTER TABLE targets ADD COLUMN sales_nav_url TEXT",
    "ALTER TABLE lists ADD COLUMN sales_nav_url TEXT",
    "ALTER TABLE accounts ADD COLUMN inbox_synced_at TEXT",
    "ALTER TABLE accounts ADD COLUMN active_hours_start INTEGER DEFAULT 9",
    "ALTER TABLE accounts ADD COLUMN active_hours_end INTEGER DEFAULT 18",
    "ALTER TABLE accounts ADD COLUMN timezone TEXT DEFAULT 'UTC'",
    "ALTER TABLE accounts ADD COLUMN working_days TEXT DEFAULT '1,2,3,4,5'",
    "ALTER TABLE workflow_steps ADD COLUMN connect_note TEXT",
    "ALTER TABLE workflow_steps ADD COLUMN message_body TEXT",
    "ALTER TABLE targets ADD COLUMN headline TEXT",
    "ALTER TABLE targets ADD COLUMN summary TEXT",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  // Migrate workflow_steps CHECK constraint to allow 'delay' step_type
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='workflow_steps'").get() as { sql: string } | undefined;
    if (tableInfo && !tableInfo.sql.includes("'delay'")) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE workflow_steps_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE,
          step_order INTEGER NOT NULL,
          step_type TEXT NOT NULL CHECK(step_type IN ('visit', 'connect', 'message', 'delay')),
          template_id INTEGER REFERENCES templates(id),
          delay_seconds INTEGER DEFAULT 0,
          connect_note TEXT,
          message_body TEXT,
          enabled INTEGER DEFAULT 1
        );
        INSERT INTO workflow_steps_new SELECT id, workflow_id, step_order, step_type, template_id, delay_seconds, NULL, NULL, enabled FROM workflow_steps;
        DROP TABLE workflow_steps;
        ALTER TABLE workflow_steps_new RENAME TO workflow_steps;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch { /* migration already done */ }

  // Backfill: for old records where linkedin_url is a Sales Nav URL, move it to sales_nav_url
  try {
    db.exec(`
      UPDATE targets
      SET sales_nav_url = linkedin_url
      WHERE linkedin_url LIKE '%/sales/lead/%' AND (sales_nav_url IS NULL OR sales_nav_url = '')
    `);
  } catch { /* ignore */ }

  // Create unique index on run_profiles if not already present (idempotent)
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_run_profiles_unique ON run_profiles(run_id, target_id);");
  } catch { /* ignore */ }
}

function initDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      cookies_json TEXT,
      is_authenticated INTEGER DEFAULT 0,
      daily_connection_limit INTEGER DEFAULT 20,
      daily_message_limit INTEGER DEFAULT 50,
      active_hours_start INTEGER DEFAULT 9,
      active_hours_end INTEGER DEFAULT 18,
      timezone TEXT DEFAULT 'UTC',
      working_days TEXT DEFAULT '1,2,3,4,5',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      linkedin_url TEXT NOT NULL UNIQUE,
      sales_nav_url TEXT,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT,
      title TEXT,
      company TEXT,
      location TEXT,
      profile_image_url TEXT,
      degree INTEGER,
      connection_requested_at TEXT,
      connected_at TEXT,
      message_sent_at TEXT,
      last_replied_at TEXT,
      linkedin_member_urn TEXT,
      enriched_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sales_nav_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS list_targets (
      list_id TEXT REFERENCES lists(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_steps (
      id TEXT PRIMARY KEY,
      workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      step_type TEXT NOT NULL CHECK(step_type IN ('visit', 'connect', 'message', 'delay')),
      template_id TEXT REFERENCES templates(id),
      delay_seconds INTEGER DEFAULT 0,
      connect_note TEXT,
      message_body TEXT,
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT REFERENCES workflows(id),
      list_id TEXT REFERENCES lists(id),
      account_id TEXT REFERENCES accounts(id),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed')),
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      runner_pid INTEGER
    );

    CREATE TABLE IF NOT EXISTS run_profiles (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id),
      state TEXT DEFAULT 'pending' CHECK(state IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
      current_step INTEGER DEFAULT 0,
      last_step_at TEXT,
      next_step_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(run_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id),
      level TEXT DEFAULT 'info' CHECK(level IN ('info', 'warn', 'error')),
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
