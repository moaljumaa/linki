import { useState } from "react";
import { RiSearchLine, RiArrowDownSLine, RiArrowRightSLine } from "react-icons/ri";

export interface OrModel { id: string; name: string; provider: string; }

const PROVIDER_DISPLAY: Record<string, string> = {
  google: "Google",
  anthropic: "Anthropic",
  openai: "OpenAI",
  mistral: "Mistral",
  qwen: "Qwen (Alibaba)",
  alibaba: "Alibaba",
};

const PROVIDER_ORDER = ["google", "anthropic", "openai", "mistral", "qwen", "alibaba"];

interface ModelPickerProps {
  models: OrModel[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}

export function ModelPicker({ models, value, onChange, placeholder = "Select a model…" }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());

  const isSearching = search.trim().length > 0;

  const filtered = models.filter(m =>
    !isSearching || m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase())
  );

  const byProvider: Record<string, OrModel[]> = {};
  for (const m of filtered) {
    (byProvider[m.provider] ??= []).push(m);
  }

  const providerOrder = [
    ...PROVIDER_ORDER.filter(p => byProvider[p]),
    ...Object.keys(byProvider).filter(p => !PROVIDER_ORDER.includes(p)).sort(),
  ];

  const selectedModel = models.find(m => m.id === value);

  function toggleProvider(p: string) {
    setCollapsedProviders(prev => {
      const n = new Set(prev);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(""); }}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-base-300/50 border border-base-300/50 text-sm text-left hover:border-base-300 transition-colors"
      >
        <span className={value ? "text-base-content" : "text-base-content/30"}>
          {selectedModel ? (
            <span className="flex items-center gap-2">
              <span className="text-base-content/40 text-xs">{PROVIDER_DISPLAY[selectedModel.provider] ?? selectedModel.provider}</span>
              <span>{selectedModel.name}</span>
            </span>
          ) : placeholder}
        </span>
        <RiSearchLine size={13} className="text-base-content/30 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(""); }} />
          <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-base-300 border border-base-300/80 rounded-xl shadow-xl overflow-hidden">
            <div className="p-2 border-b border-base-300/50">
              <input
                autoFocus
                type="text"
                placeholder="Search models…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-base-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none placeholder:text-base-content/30"
              />
            </div>
            <div className="max-h-72 overflow-y-auto">
              {models.length === 0 ? (
                <p className="px-3 py-4 text-sm text-base-content/30 text-center">No OpenRouter key configured</p>
              ) : filtered.length === 0 ? (
                <p className="px-3 py-4 text-sm text-base-content/30 text-center">No models match</p>
              ) : providerOrder.map(provider => {
                const providerModels = byProvider[provider];
                const isCollapsed = !isSearching && collapsedProviders.has(provider);
                const displayName = PROVIDER_DISPLAY[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
                return (
                  <div key={provider}>
                    <button
                      type="button"
                      onClick={() => !isSearching && toggleProvider(provider)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 sticky top-0 bg-base-300/90 backdrop-blur-sm border-b border-base-300/30 ${isSearching ? "cursor-default" : "hover:bg-base-300 cursor-pointer"}`}
                    >
                      <span className="text-[10px] uppercase tracking-wider text-base-content/40 font-semibold">{displayName}</span>
                      {!isSearching && (
                        <span className="text-base-content/30">
                          {isCollapsed ? <RiArrowRightSLine size={13} /> : <RiArrowDownSLine size={13} />}
                        </span>
                      )}
                      {isSearching && (
                        <span className="text-[10px] text-base-content/25">{providerModels.length}</span>
                      )}
                    </button>
                    {!isCollapsed && providerModels.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { onChange(m.id); setOpen(false); setSearch(""); }}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-base-200 ${value === m.id ? "text-primary font-medium" : "text-base-content/80"}`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
