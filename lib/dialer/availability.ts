// Shared by the Dialer page (browser tz) and the MCP (caller-supplied tz).
export interface Slot { day: number; open_time: string; close_time: string }

export interface QueueRow {
  id: string;
  timezone: string | null;
  call_status: string | null;
  call_attempts: number;
  last_called_at: string | null;
  call_callback_at: string | null;
  slots: Slot[];
}

export const COOLDOWN_MIN = 120; // no-answer / voicemail come back after this
export const TERMINAL = ["reached", "not_interested", "wrong_number"];

// Day-of-week (0=Sun) and minutes-since-midnight at `ms` in timezone `tz`.
export function partsAt(tz: string, ms: number, fallbackTz: string): { day: number; min: number } {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms));
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), min: Number(get("hour")) * 60 + Number(get("minute")) };
  } catch {
    return tz === fallbackTz ? { day: 0, min: 0 } : partsAt(fallbackTz, ms, fallbackTz);
  }
}

function toMin(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

export type Avail = { open: boolean; closesIn?: number; opensIn?: number; noHours?: boolean };

export function availability(r: QueueRow, now: number, myTz: string): Avail {
  if (r.slots.length === 0) return { open: true, noHours: true };
  const tz = r.timezone || myTz;
  const cur = partsAt(tz, now, myTz);
  const slot = r.slots.find((s) => s.day === cur.day && cur.min >= toMin(s.open_time) && cur.min < toMin(s.close_time));
  if (slot) return { open: true, closesIn: toMin(slot.close_time) - cur.min };
  let best = Infinity;
  for (let k = 0; k <= 7; k++) {
    const p = partsAt(tz, now + k * 86400000, myTz);
    for (const s of r.slots) {
      if (s.day !== p.day) continue;
      const start = toMin(s.open_time);
      if (k === 0 && start <= cur.min) continue;
      best = Math.min(best, k * 1440 + start - cur.min);
    }
  }
  return { open: false, opensIn: best };
}

export type Bucket = "now" | "later" | "waiting" | "nohours" | "done";

export function bucketOf(r: QueueRow, now: number, av: Avail): { bucket: Bucket; waitUntil?: number } {
  if (r.call_status && TERMINAL.includes(r.call_status)) return { bucket: "done" };
  if (r.call_status === "callback" && r.call_callback_at) {
    const t = new Date(r.call_callback_at).getTime();
    if (t > now) return { bucket: "waiting", waitUntil: t };
  }
  if ((r.call_status === "no_answer" || r.call_status === "voicemail") && r.last_called_at) {
    const t = new Date(r.last_called_at).getTime() + COOLDOWN_MIN * 60000;
    if (t > now) return { bucket: "waiting", waitUntil: t };
  }
  if (av.noHours) return { bucket: "nohours" };
  return { bucket: av.open ? "now" : "later" };
}
