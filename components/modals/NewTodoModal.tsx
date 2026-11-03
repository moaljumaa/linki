import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine } from "react-icons/ri";
import DateTimePicker from "@/components/ui/DateTimePicker";

export interface Todo {
  id: string;
  target_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  status: "open" | "done";
  created_at: string;
}

// The one "New todo" modal — contact page + dialer call wizard.
export default function NewTodoModal({ targetId, onClose, onSave, initialTitle = "", initialDue = "", subtitle, cancelLabel = "Cancel" }: {
  targetId: string;
  onClose: () => void;
  onSave: (todo: Todo) => void;
  initialTitle?: string;
  initialDue?: string; // local "YYYY-MM-DDTHH:mm"
  subtitle?: string;
  cancelLabel?: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState("");
  const [due, setDue] = useState(initialDue);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const [due_date, due_time] = due ? due.split("T") : [undefined, undefined];
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: targetId, title: title.trim(), description: description.trim() || undefined, due_date, due_time }),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to create"); return; }
    onSave(await res.json() as Todo);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-base-100 border border-base-300/60 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-base-300/40">
          <div>
            <h2 className="text-sm font-semibold text-base-content">New todo</h2>
            {subtitle && <p className="text-[11px] text-base-content/40 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors">
            <RiCloseLine size={16} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder="Task title"
            className="w-full bg-transparent text-base font-medium text-base-content placeholder-base-content/25 focus:outline-none border-b border-base-300/30 pb-3"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description..."
            rows={3}
            className="w-full bg-base-200/60 border border-base-300/40 rounded-xl px-4 py-3 text-sm text-base-content/80 placeholder-base-content/25 leading-relaxed focus:outline-none focus:border-base-300/80 resize-none transition-colors"
          />
          <div>
            <label className="block text-[11px] text-base-content/40 uppercase tracking-wide mb-1.5">Due</label>
            <DateTimePicker value={due} onChange={setDue} placeholder="No due date" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-base-300/40">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-base-content/50 hover:text-base-content hover:bg-base-300/40 transition-colors">
            {cancelLabel}
          </button>
          <button
            onClick={save}
            disabled={!title.trim() || saving}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary/90 text-primary-content hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Create todo"}
          </button>
        </div>
      </div>
    </div>
  );
}
