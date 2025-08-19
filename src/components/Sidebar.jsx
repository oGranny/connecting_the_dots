import React, { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Loader2, Search, File } from "lucide-react";
import { cls } from "../lib/utils";

export default function Sidebar({ headings = [], status, onJumpToHeading, onFilter, files = [], activeFileId, onFileSelect }) {
  const [open, setOpen] = useState({ toc: true, files: true });

  const Section = ({ id, title, children }) => (
    <div className="mb-4 select-none">
      <button
        onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}
        className="w-full flex items-center gap-2 text-slate-200 hover:text-white"
      >
        {open[id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="text-sm font-medium">{title}</span>
      </button>
      {open[id] && <div className="mt-2 pl-2 space-y-2">{children}</div>}
    </div>
  );

  return (
    <div className="p-3">
      {/* <div className="p-2 border border-slate-700 rounded-lg bg-slate-800/40 mb-3 flex items-center gap-2">
        <Search size={16} className="opacity-70" />
        <input
          placeholder="Filter headings…"
          className="bg-transparent outline-none text-xs flex-1 placeholder:text-slate-400"
          onChange={(e) => onFilter?.(e.target.value)}
        />
      </div> */}

      {status === "pending" && (
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-300 bg-slate-800/60 border border-slate-700 rounded-md px-2 py-1">
          <Loader2 className="animate-spin" size={14} /> Analyzing headings…
        </div>
      )}
      {status === "error" && (
        <div className="mb-3 text-xs text-red-300 bg-red-900/30 border border-red-700 rounded-md px-2 py-1">
          Heading detection failed (check backend).
        </div>
      )}

      <Section id="toc" title="Table of Contents">
        {status === "pending" && (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-6 rounded-md bg-slate-800/50 animate-pulse" />
            ))}
          </div>
        )}

        {status !== "pending" && (!headings || headings.length === 0) && (
          <div className="text-xs text-slate-400">No headings found.</div>
        )}

        {headings?.map((h) => (
          <div
            key={h.id}
            onClick={() => onJumpToHeading?.(h.page)}
            className={cls(
              "px-2 py-1 rounded-md cursor-pointer flex items-center gap-2",
              h.level === 1 ? "bg-slate-800/60" : h.level === 2 ? "bg-slate-800/30" : "bg-slate-800/10",
              "hover:bg-slate-700/50"
            )}
            title={`Go to page ${h.page}`}
          >
          <span className="inline-flex items-center justify-center w-4 h-4 mr-2 flex-none leading-none">
            <FileText className="w-3.5 h-3.5 text-slate-300" strokeWidth={1.8} aria-hidden="true" />
          </span>
            <span className="text-xs truncate">H{h.level} · {h.title}</span>
            {/* <span className="ml-auto text-[10px] text-slate-400">p.{h.page}</span> */}
          </div>
        ))}
      </Section>

      <Section id="files" title="Files">
        {(!files || files.length === 0) && (
          <div className="text-xs text-slate-400">No files loaded.</div>
        )}

        {files?.map((file) => (
          <div
            key={file.id}
            onClick={() => onFileSelect?.(file.id)}
            className={cls(
              "px-2 py-1 rounded-md cursor-pointer flex items-center gap-2",
              activeFileId === file.id ? "bg-slate-700/70" : "bg-slate-800/30",
              "hover:bg-slate-700/50"
            )}
            title={`Switch to ${file.name}`}
          >
            <span className="inline-flex items-center justify-center w-4 h-4 mr-2 flex-none leading-none">
              <File className="w-3.5 h-3.5 text-slate-300" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="text-xs truncate">{file.name}</span>
            {activeFileId === file.id && (
              <span className="ml-auto text-[10px] text-emerald-400"></span>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}
