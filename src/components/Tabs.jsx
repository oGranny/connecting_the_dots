import React from "react";
import { FileText, Loader2, Plus, X } from "lucide-react";
import { cls } from "../lib/utils";

export default function Tabs({ files, activeId, onSelect, onClose, onAdd, analyzing }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-2 border-b border-white/10">
      <div className="flex-1 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1">
          {files.map((f) => {
            const state = analyzing[f.id]; // 'pending' | 'done' | 'error' | undefined
            return (
              <button
                key={f.id}
                onClick={() => onSelect(f.id)}
                className={cls(
                  "group inline-flex items-center gap-2 px-3 py-1.5 rounded-t-md border border-b-0",
                  f.id === activeId
                    ? "bg-white/10 text-white border-white/20"
                    : "bg-neutral-900/60 text-slate-300 border-white/10 hover:bg-white/5 hover:text-white"
                )}
                title={f.name}
              >
                {state === "pending" ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                <span className="text-xs max-w-[160px] truncate">{f.name}</span>
                {state === "error" && <span className="text-[10px] text-red-300 ml-1">err</span>}
                <X
                  size={14}
                  className="opacity-70 ml-1 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(f.id);
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <label className="ml-auto mb-[-1px]">
        <input
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => onAdd(Array.from(e.target.files || []))}
        />
        <div className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer">
          <Plus size={14} /> New
        </div>
      </label>
    </div>
  );
}
