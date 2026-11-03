// Minimal shape both a real NextApiRequest and NextAuth's authorize() RequestInternal
// satisfy — socket is optional since RequestInternal doesn't expose one.
type IpSource = {
  headers?: { [key: string]: string | string[] | undefined };
  socket?: { remoteAddress?: string };
};

// In-memory sliding-window rate limiter, per IP. No Redis/external service (self-hosted,
// single process — see CLAUDE.md). Resets on server restart; acceptable for a single-user
// tool defending against brute force on login/signup, not a distributed-attack mitigation.
const hits = new Map<string, number[]>();

// Periodically drop stale keys so this doesn't grow unbounded over a long-running process.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweep = Date.now();

export function isRateLimited(req: IpSource, key: string, limit: number, windowMs: number): boolean {
  const ip = clientIp(req);
  const mapKey = `${key}:${ip}`;
  const now = Date.now();

  sweepIfDue(now, windowMs);

  const timestamps = (hits.get(mapKey) ?? []).filter(t => now - t < windowMs);
  if (timestamps.length >= limit) {
    hits.set(mapKey, timestamps);
    return true;
  }

  timestamps.push(now);
  hits.set(mapKey, timestamps);
  return false;
}

function sweepIfDue(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [mapKey, timestamps] of hits) {
    const fresh = timestamps.filter(t => now - t < windowMs);
    if (fresh.length === 0) hits.delete(mapKey);
    else hits.set(mapKey, fresh);
  }
}

function clientIp(req: IpSource): string {
  const xRealIp = req.headers?.["x-real-ip"];
  if (typeof xRealIp === "string" && xRealIp) return xRealIp;

  const xForwardedFor = req.headers?.["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor) return xForwardedFor.split(",")[0].trim();

  return req.socket?.remoteAddress || "unknown";
}
