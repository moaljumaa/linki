import Head from "next/head";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CHARACTERS, Dialy, loadAvatar, saveAvatar, type DialyCharacter } from "@/components/dialer/Cheerleader";

export default function DialerSettingsPage() {
  const [sel, setSel] = useState<DialyCharacter>("dialy");
  useEffect(() => setSel(loadAvatar()), []);

  function pick(c: DialyCharacter, name: string) {
    setSel(c);
    saveAvatar(c);
    toast.success(`${name} is on the team`);
  }

  return (
    <>
      <Head><title>Dialer settings — Linki</title></Head>
      <div className="max-w-3xl">
        <h1 className="text-base font-semibold text-base-content tracking-tight">Dialer settings</h1>
        <p className="text-xs text-base-content/40 mt-1 mb-6">Pick who cheers you on during calls.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CHARACTERS.map((c) => (
            <button
              key={c.key}
              onClick={() => pick(c.key, c.name)}
              className={`flex flex-col items-center gap-1 pt-4 pb-3 px-2 rounded-2xl border transition-colors ${sel === c.key ? "bg-primary/10 border-primary/40" : "bg-base-200/50 border-base-300/30 hover:bg-base-200"}`}
            >
              <Dialy size={110} character={c.key} mood={sel === c.key ? "cheer" : "idle"} />
              <span className="text-sm font-medium text-base-content">{c.name}</span>
              <span className="text-[11px] text-base-content/40">{c.tagline}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
