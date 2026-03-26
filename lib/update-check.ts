/**
 * Update checker — polls Docker Hub tags to detect if a newer version of the
 * image has been published. Runs once on startup, then every 12 hours.
 *
 * State is kept in memory (reset on restart, which is fine — it re-checks immediately).
 */

const DOCKER_HUB_TAGS_URL =
  "https://hub.docker.com/v2/repositories/moaljumaa/linki/tags?page_size=50&ordering=last_updated";

const POLL_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface UpdateState {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
}

const state: UpdateState = {
  current: process.env.APP_VERSION ?? "dev",
  latest: null,
  updateAvailable: false,
  checkedAt: null,
};

export function getUpdateState(): UpdateState {
  return { ...state };
}

/** Parse semver string like "1.2.3" → [1, 2, 3]. Returns null if not semver. */
function parseSemver(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

/** Returns true if b is strictly greater than a */
function isNewer(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  if (pb[0] !== pa[0]) return pb[0] > pa[0];
  if (pb[1] !== pa[1]) return pb[1] > pa[1];
  return pb[2] > pa[2];
}

async function checkForUpdate() {
  try {
    const res = await fetch(DOCKER_HUB_TAGS_URL);
    if (!res.ok) return;

    const data = await res.json() as { results?: { name: string }[] };
    const tags: string[] = (data.results ?? [])
      .map((t) => t.name)
      .filter((n) => parseSemver(n) !== null);

    if (tags.length === 0) return;

    // Find highest semver tag
    const latest = tags.reduce((best, tag) => {
      return isNewer(best, tag) ? tag : best;
    }, tags[0]);

    state.latest = latest;
    state.updateAvailable = state.current !== "dev" && isNewer(state.current, latest);
    state.checkedAt = new Date().toISOString();

    if (state.updateAvailable) {
      console.log(`[update-check] New version available: ${latest} (running ${state.current})`);
    }
  } catch {
    // Non-fatal — silently ignore network errors
  }
}

const g = global as typeof global & { __updateCheckScheduled?: boolean };

export function scheduleUpdateCheck() {
  if (g.__updateCheckScheduled) return;
  g.__updateCheckScheduled = true;

  // Run immediately on startup (non-blocking)
  checkForUpdate();

  // Then every 12 hours
  setInterval(checkForUpdate, POLL_INTERVAL_MS);
}
