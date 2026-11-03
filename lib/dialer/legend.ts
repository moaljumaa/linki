// Playful "how much of a legend are you" scoring. XP: 1 per dial, +5 per real conversation,
// +1 per minute talked. Pure functions, shared by the dialer page, wizard and analytics.

export const LEVELS = [
  { at: 0, name: "Warm-up Walker", emoji: "🐣" },
  { at: 25, name: "Rookie Dialer", emoji: "📞" },
  { at: 100, name: "Smooth Talker", emoji: "🎙️" },
  { at: 300, name: "Objection Crusher", emoji: "🥊" },
  { at: 700, name: "Phone Ninja", emoji: "🥷" },
  { at: 1500, name: "Cold-Call Captain", emoji: "⚓" },
  { at: 3000, name: "Dial Master", emoji: "🧙" },
  { at: 6000, name: "Living Legend", emoji: "👑" },
] as const;

export function xpOf(calls: number, reached: number, talkSec: number) {
  return calls + reached * 5 + Math.floor(talkSec / 60);
}

export function levelOf(xp: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].at) i++;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] ?? null;
  const pct = next ? Math.min(100, ((xp - cur.at) / (next.at - cur.at)) * 100) : 100;
  return { index: i, cur, next, pct, toNext: next ? next.at - xp : 0 };
}

export const DAILY_GOAL = 30;

// A line for the dialer based on today's grind.
export function quip(callsToday: number, reachedToday: number) {
  if (callsToday === 0) return "Cold phone, warm heart. Let's make the first one count.";
  if (callsToday < 5) return "Warming up — the first few are always the hardest.";
  if (reachedToday >= 3) return "Humans are picking up for you today. Absolute menace.";
  if (callsToday < 15) return "Rhythm unlocked. Every 'no' is a step toward a 'yes'.";
  if (callsToday < DAILY_GOAL) return "Past the halfway mark — the legends don't stop here.";
  if (callsToday < DAILY_GOAL * 2) return "Daily goal smashed. Now you're just showing off. 🔥";
  return "Unstoppable. Someone check if the phone is on fire.";
}

export const CHEERS = [
  "You've got this! 🎉",
  "Smile — they can hear it. 😄",
  "Every call is a coin flip you've rigged. 🪙",
  "Breathe, then charm. ✨",
  "Be curious, not pitchy. 🔍",
  "A 'no' just clears the path to a 'yes'. 🚀",
  "Slow down. Confidence is calm. 🧘",
  "Make their day a little better. 💛",
  "Legend behaviour right here. 👑",
  "Listen twice, talk once. 👂",
];
