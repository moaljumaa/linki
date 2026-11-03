import { useEffect, useId, useState } from "react";
import { CHEERS } from "@/lib/dialer/legend";

// Dialy — the cheering mascot the caller watches during a call. Pure SVG + CSS keyframes (globals.css).
export type DialyMood = "cheer" | "idle" | "celebrate";
export type DialyCharacter = "dialy" | "bolt" | "miso" | "mochi";

export const CHARACTERS: { key: DialyCharacter; name: string; tagline: string }[] = [
  { key: "dialy", name: "Dialy", tagline: "The original blob" },
  { key: "bolt", name: "Bolt", tagline: "Robot, fully charged" },
  { key: "miso", name: "Miso", tagline: "Cat with attitude" },
  { key: "mochi", name: "Mochi", tagline: "Soft bunny, big energy" },
];

// body gradient stops [light, mid, dark], limb/foot color
const PALETTE: Record<DialyCharacter, { body: [string, string, string]; limb: string; foot: string }> = {
  dialy: { body: ["#a7f3d0", "#34d399", "#059669"], limb: "#10b981", foot: "#059669" },
  bolt: { body: ["#bae6fd", "#60a5fa", "#1d4ed8"], limb: "#3b82f6", foot: "#1d4ed8" },
  miso: { body: ["#fed7aa", "#fb923c", "#c2410c"], limb: "#f97316", foot: "#c2410c" },
  mochi: { body: ["#fbcfe8", "#f472b6", "#be185d"], limb: "#ec4899", foot: "#be185d" },
};

const AVATAR_KEY = "dialer.avatar";
export function loadAvatar(): DialyCharacter {
  try {
    const v = localStorage.getItem(AVATAR_KEY) as DialyCharacter | null;
    if (v && v in PALETTE) return v;
  } catch {}
  return "dialy";
}
export function saveAvatar(c: DialyCharacter) {
  try { localStorage.setItem(AVATAR_KEY, c); } catch {}
}
// SSR-safe: starts on the default, switches to the saved one after mount
export function useAvatar(): DialyCharacter {
  const [c, setC] = useState<DialyCharacter>("dialy");
  useEffect(() => setC(loadAvatar()), []);
  return c;
}

// [dx, dy, spin, color] — confetti burst directions
const CONFETTI: [number, number, number, string][] = [
  [-62, -34, 20, "#fbbf24"], [-44, -58, -40, "#f472b6"], [-18, -70, 70, "#60a5fa"], [10, -66, -20, "#34d399"],
  [38, -62, 50, "#fbbf24"], [60, -38, -60, "#f472b6"], [-70, -8, 30, "#a78bfa"], [70, -14, -30, "#60a5fa"],
  [-30, -44, 90, "#34d399"], [28, -48, 10, "#a78bfa"],
];

export function Dialy({ size = 180, excited = true, mood, character }: { size?: number; excited?: boolean; mood?: DialyMood; character?: DialyCharacter }) {
  const ch = useAvatar();
  const who = character ?? ch;
  const pal = PALETTE[who];
  const m: DialyMood = mood ?? (excited ? "cheer" : "idle");
  const id = useId().replace(/:/g, "");
  const up = m !== "idle";
  const happy = m === "celebrate";
  const g = (n: string) => `${n}-${id}`;
  const u = (n: string) => `url(#${g(n)})`;
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" className={`dialy dialy-${m}`} aria-hidden overflow="visible">
      <defs>
        <radialGradient id={g("body")} cx="38%" cy="28%" r="85%">
          <stop offset="0" stopColor={pal.body[0]} />
          <stop offset="0.5" stopColor={pal.body[1]} />
          <stop offset="1" stopColor={pal.body[2]} />
        </radialGradient>
        <radialGradient id={g("belly")} cx="50%" cy="40%" r="60%">
          <stop offset="0" stopColor="#ecfdf5" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ecfdf5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g("cup")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
        <radialGradient id={g("pom")} cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#fef3c7" />
          <stop offset="0.5" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#f97316" />
        </radialGradient>
      </defs>

      {up && (
        <g fill="#fde68a">
          <path className="dialy-spark" style={{ animationDelay: "0s" }} d="M18 34l2.6 6.4 6.4 2.6-6.4 2.6-2.6 6.4-2.6-6.4-6.4-2.6 6.4-2.6z" />
          <path className="dialy-spark" style={{ animationDelay: "0.7s" }} d="M142 26l2.2 5.4 5.4 2.2-5.4 2.2-2.2 5.4-2.2-5.4-5.4-2.2 5.4-2.2z" />
          <path className="dialy-spark" style={{ animationDelay: "1.3s" }} d="M148 96l1.8 4.4 4.4 1.8-4.4 1.8-1.8 4.4-1.8-4.4-4.4-1.8 4.4-1.8z" />
        </g>
      )}

      {happy && (
        <g>
          {CONFETTI.map(([dx, dy, r, c], i) => (
            <rect
              key={i}
              className="dialy-confetti"
              x={78} y={50} width={i % 3 === 0 ? 5 : 7} height={i % 3 === 0 ? 5 : 3.5} rx={i % 3 === 0 ? 2.5 : 1}
              fill={c}
              style={{ ["--dx" as string]: `${dx}px`, ["--dy" as string]: `${dy}px`, ["--r" as string]: `${r * 6}deg`, animationDelay: `${(i % 5) * 0.12}s` }}
            />
          ))}
        </g>
      )}

      <ellipse className="dialy-shadow" cx="80" cy="146" rx="34" ry="5" fill="#000" opacity="0.35" />

      <g className="dialy-body">
        {up ? (
          <>
            <g className="dialy-arm-l">
              <path d="M44 106 Q26 92 22 66" stroke={pal.limb} strokeWidth="12" strokeLinecap="round" fill="none" />
              <circle cx="21" cy="58" r="12" fill={u("pom")} />
              <circle cx="17" cy="54" r="3.5" fill="#fff" opacity="0.6" />
            </g>
            <g className="dialy-arm-r">
              <path d="M116 106 Q134 92 138 66" stroke={pal.limb} strokeWidth="12" strokeLinecap="round" fill="none" />
              <circle cx="139" cy="58" r="12" fill={u("pom")} />
              <circle cx="135" cy="54" r="3.5" fill="#fff" opacity="0.6" />
            </g>
          </>
        ) : (
          <>
            <ellipse cx="33" cy="112" rx="8" ry="12" fill={pal.limb} transform="rotate(14 33 112)" />
            <ellipse cx="127" cy="112" rx="8" ry="12" fill={pal.limb} transform="rotate(-14 127 112)" />
          </>
        )}

        <ellipse cx="62" cy="139" rx="12" ry="6.5" fill={pal.foot} />
        <ellipse cx="98" cy="139" rx="12" ry="6.5" fill={pal.foot} />

        {who === "miso" && (
          <>
            <path d="M38 62 L36 26 L66 46z" fill={pal.limb} />
            <path d="M122 62 L124 26 L94 46z" fill={pal.limb} />
            <path d="M42 54 L41 36 L56 46z" fill="#fda4af" />
            <path d="M118 54 L119 36 L104 46z" fill="#fda4af" />
          </>
        )}
        {who === "mochi" && (
          <>
            <ellipse cx="56" cy="22" rx="11" ry="28" fill={pal.limb} transform="rotate(-10 56 22)" />
            <ellipse cx="104" cy="22" rx="11" ry="28" fill={pal.limb} transform="rotate(10 104 22)" />
            <ellipse cx="56" cy="24" rx="5" ry="20" fill="#fbcfe8" transform="rotate(-10 56 24)" />
            <ellipse cx="104" cy="24" rx="5" ry="20" fill="#fbcfe8" transform="rotate(10 104 24)" />
          </>
        )}
        {who === "bolt" && (
          <>
            <path d="M80 44 V24" stroke="#93c5fd" strokeWidth="4" strokeLinecap="round" />
            <circle cx="80" cy="20" r="6" fill="#fbbf24" />
            <circle cx="78" cy="18" r="2" fill="#fff" opacity="0.7" />
          </>
        )}
        <path d="M80 44c28 0 48 20 48 48 0 26-18 45-48 45S32 118 32 92c0-28 20-48 48-48z" fill={u("body")} />
        <ellipse cx="80" cy="112" rx="30" ry="20" fill={u("belly")} />
        <ellipse cx="56" cy="64" rx="14" ry="7" fill="#fff" opacity="0.28" transform="rotate(-28 56 64)" />

        {/* headset */}
        <path d="M34 82 C32 34 128 34 126 82" fill="none" stroke="#6366f1" strokeWidth="6.5" strokeLinecap="round" />
        <path d="M40 66 C50 44 70 40 84 40" fill="none" stroke="#c7d2fe" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        <rect x="26" y="72" width="15" height="28" rx="7" fill={u("cup")} />
        <rect x="119" y="72" width="15" height="28" rx="7" fill={u("cup")} />
        <path d="M126 98 Q124 118 100 114" fill="none" stroke="#4f46e5" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="98" cy="114" r="5.5" fill="#fb923c" />
        <circle cx="96.5" cy="112.5" r="1.8" fill="#fff" opacity="0.7" />

        {/* face */}
        {happy ? (
          <g fill="none" stroke="#12263a" strokeWidth="4.5" strokeLinecap="round">
            <path d="M54 88 Q62 76 70 88" />
            <path d="M90 88 Q98 76 106 88" />
          </g>
        ) : (
          <g className="dialy-eyes">
            <ellipse cx="63" cy="86" rx="7" ry={up ? 9.5 : 8.5} fill="#12263a" />
            <ellipse cx="97" cy="86" rx="7" ry={up ? 9.5 : 8.5} fill="#12263a" />
            <circle cx="65.5" cy="82.5" r="2.8" fill="#fff" />
            <circle cx="99.5" cy="82.5" r="2.8" fill="#fff" />
            <circle cx="61" cy="89.5" r="1.3" fill="#fff" opacity="0.8" />
            <circle cx="95" cy="89.5" r="1.3" fill="#fff" opacity="0.8" />
          </g>
        )}
        <ellipse cx="49" cy="100" rx="8" ry="5" fill="#fda4af" opacity="0.85" />
        <ellipse cx="111" cy="100" rx="8" ry="5" fill="#fda4af" opacity="0.85" />
        {who === "miso" && (
          <g stroke="#7c2d12" strokeWidth="2" strokeLinecap="round" opacity="0.6">
            <path d="M34 98 H18 M34 104 L20 110" /><path d="M126 98 H142 M126 104 L140 110" />
          </g>
        )}
        {who === "bolt" && (
          <g fill="#1e3a8a" opacity="0.55">
            <circle cx="44" cy="62" r="2.2" /><circle cx="116" cy="62" r="2.2" />
          </g>
        )}
        {m === "idle" && <path d="M72 101 Q80 108 88 101" fill="none" stroke="#12263a" strokeWidth="3.5" strokeLinecap="round" />}
        {m === "cheer" && (
          <>
            <path d="M68 98 Q80 118 92 98 Q80 102 68 98z" fill="#7f1d1d" stroke="#7f1d1d" strokeWidth="3" strokeLinejoin="round" />
            <path d="M74 108 Q80 104 86 108 Q80 114 74 108z" fill="#fb7185" />
          </>
        )}
        {happy && (
          <>
            <path d="M62 97 Q80 126 98 97 Q80 102 62 97z" fill="#7f1d1d" stroke="#7f1d1d" strokeWidth="3" strokeLinejoin="round" />
            <path d="M71 110 Q80 104 89 110 Q80 119 71 110z" fill="#fb7185" />
            <path d="M66 99 Q80 103 94 99 L93 102 Q80 106 67 102z" fill="#fff" />
          </>
        )}
      </g>
    </svg>
  );
}

// Dialy + a rotating speech bubble. `extra` lets the caller push situational lines (e.g. long call).
export default function Cheerleader({ seconds = 0, size = 170, character }: { seconds?: number; size?: number; character?: DialyCharacter }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * CHEERS.length));
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % CHEERS.length), 7000);
    return () => clearInterval(t);
  }, []);

  const line =
    seconds > 0 && seconds < 8 ? "Ringing… deep breath! 🫶"
    : seconds >= 300 ? "5+ minutes — that's a real conversation! 🔥"
    : seconds >= 120 ? "Great talk! Keep the momentum. 💬"
    : CHEERS[i];

  return (
    <div className="flex flex-col items-center">
      <div key={line} className="dialer-pop relative px-4 py-2.5 rounded-2xl bg-base-200 border border-base-300/60 text-sm text-base-content/80 text-center max-w-[240px] mb-2 shadow-sm">
        {line}
        <span className="absolute left-1/2 -bottom-1.5 w-3 h-3 -translate-x-1/2 rotate-45 bg-base-200 border-r border-b border-base-300/60" />
      </div>
      <Dialy size={size} character={character} />
    </div>
  );
}
