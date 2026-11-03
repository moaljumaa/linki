import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const runId = req.query.id as string;
  const { target_ids } = req.body as { target_ids?: string[] };

  if (!Array.isArray(target_ids) || target_ids.length === 0) {
    return res.status(400).json({ error: "target_ids required" });
  }

  const run = db
    .prepare("SELECT id, workflow_id FROM runs WHERE id = ?")
    .get(runId) as { id: string; workflow_id: string } | undefined;
  if (!run) return res.status(404).json({ error: "run_not_found" });

  // Tracks defined on this workflow
  const workflowTracks = [...new Set(
    (db.prepare("SELECT DISTINCT track FROM workflow_steps WHERE workflow_id = ?").all(run.workflow_id) as { track: string }[]).map((r) => r.track)
  )];
  if (workflowTracks.length === 0) workflowTracks.push("linkedin");

  // Existing email-account pool for this run (used as round-robin pool for new enrollments)
  const emailAccountPool: string[] = (db
    .prepare(
      `SELECT DISTINCT email_account_id FROM run_profiles
       WHERE run_id = ? AND email_account_id IS NOT NULL`
    )
    .all(runId) as Array<{ email_account_id: string }>).map((r) => r.email_account_id);

  // Dedup: already enrolled in this workflow at all
  const alreadyEnrolled = new Set(
    (db
      .prepare(
        `SELECT DISTINCT rp.target_id FROM run_profiles rp
         JOIN runs r ON r.id = rp.run_id
         WHERE r.workflow_id = ?`
      )
      .all(run.workflow_id) as { target_id: string }[]).map((r) => r.target_id)
  );

  // Active elsewhere (in some other running/paused run with an in-progress track)
  const activeElsewhere = new Set(
    (db
      .prepare(
        `SELECT DISTINCT rp.target_id FROM run_profiles rp
         JOIN runs r ON r.id = rp.run_id
         WHERE r.status IN ('running', 'paused')
         AND EXISTS (
           SELECT 1 FROM run_profile_tracks rt
           WHERE rt.run_profile_id = rp.id AND rt.state NOT IN ('completed', 'failed', 'skipped')
         )`
      )
      .all() as { target_id: string }[]).map((r) => r.target_id)
  );

  let skipped_already_enrolled = 0;
  let skipped_active_elsewhere = 0;
  const eligible: string[] = [];
  for (const tid of target_ids) {
    if (alreadyEnrolled.has(tid)) { skipped_already_enrolled++; continue; }
    if (activeElsewhere.has(tid)) { skipped_active_elsewhere++; continue; }
    eligible.push(tid);
  }

  if (eligible.length === 0) {
    return res.json({ enrolled: 0, skipped_already_enrolled, skipped_active_elsewhere });
  }

  // Assign email accounts: company-grouped round-robin (same as run creation)
  const emailAssignment = new Map<string, string | null>();
  if (emailAccountPool.length > 0) {
    const placeholders = eligible.map(() => "?").join(",");
    const companyRows = db
      .prepare(`SELECT id, company_id FROM targets WHERE id IN (${placeholders})`)
      .all(...eligible) as { id: string; company_id: string | null }[];
    const companyAccountMap = new Map<string, string>();
    let cursor = 0;
    for (const row of companyRows) {
      if (row.company_id) {
        if (!companyAccountMap.has(row.company_id)) {
          companyAccountMap.set(row.company_id, emailAccountPool[cursor % emailAccountPool.length]);
          cursor++;
        }
        emailAssignment.set(row.id, companyAccountMap.get(row.company_id)!);
      } else {
        emailAssignment.set(row.id, emailAccountPool[cursor % emailAccountPool.length]);
        cursor++;
      }
    }
  }

  const insertProfile = db.prepare(
    "INSERT INTO run_profiles (id, run_id, target_id, email_account_id) VALUES (?, ?, ?, ?)"
  );
  const insertTrack = db.prepare(
    "INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, ?, 'pending', 0)"
  );
  const insertMany = db.transaction((ids: string[]) => {
    for (const tid of ids) {
      const assignedEmailAccountId = emailAssignment.get(tid) ?? null;
      const rpId = randomUUID();
      insertProfile.run(rpId, runId, tid, assignedEmailAccountId);
      for (const track of workflowTracks) {
        if (track === "email" && !assignedEmailAccountId) continue;
        insertTrack.run(randomUUID(), rpId, track);
      }
    }
  });
  insertMany(eligible);

  return res.json({
    enrolled: eligible.length,
    skipped_already_enrolled,
    skipped_active_elsewhere,
  });
}
