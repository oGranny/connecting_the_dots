import React from "react";
import { FileText, ListTree, CheckCircle2, XCircle, Clock, Server, Activity } from "lucide-react";

function fmtBytes(n) {
  if (typeof n !== "number") return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function Chip({ children, title }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 px-2 h-6 rounded-md border border-white/10 bg-white/10 text-white/90"
    >
      {children}
    </span>
  );
}

const TONES = {
  charcoal: "bg-neutral-900 text-white/95 border-t border-neutral-800",
  violet:   "bg-violet-600 text-white",
  emerald:  "bg-emerald-600 text-white",
  rose:     "bg-rose-600 text-white",
  slate:    "bg-neutral-950 text-white/95 border-t border-neutral-800",
};

export default function StatusBar({
  activeFile,
  headingsCount = 0,
  analyzingStatus, // 'pending' | 'done' | 'error' | undefined
  backend = { online: false, pingMs: null },
  viewerStatus = {}, // { page }
  tone = "charcoal", // <-- choose: charcoal | violet | emerald | rose | slate
}) {
  const statusIcon =
    analyzingStatus === "pending" ? <Clock size={14} /> :
    analyzingStatus === "error" ? <XCircle size={14} /> :
    analyzingStatus === "done" ? <CheckCircle2 size={14} /> :
    <Clock size={14} />;

  const statusText =
    analyzingStatus === "pending" ? "Analyzing…" :
    analyzingStatus === "error" ? "Analysis failed" :
    analyzingStatus === "done" ? "Analysis ready" :
    "Idle";

  const barClass = TONES[tone] || TONES.charcoal;

  return (
    <div className={`h-8 w-full ${barClass} flex items-center justify-between px-3 text-xs select-none`}>
      {/* Left cluster */}
      <div className="flex items-center gap-2 min-w-0">
        <Chip title={activeFile?.name || "No file"}>
          <FileText size={14} />
          <span className="truncate max-w-[22rem]">{activeFile?.name || "No document"}</span>
          {activeFile?.size != null && <span className="opacity-80">· {fmtBytes(activeFile.size)}</span>}
        </Chip>
        <Chip title="Visible headings in Sidebar">
          <ListTree size={14} />
          <span>{headingsCount} headings</span>
        </Chip>
        <Chip title="Document analysis status">
          {statusIcon}
          <span>{statusText}</span>
        </Chip>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-2">
        <Chip title="Current page (from viewer)">
          <Activity size={14} />
          <span>Pg {viewerStatus?.page ?? 1}</span>
        </Chip>
        <Chip title="Backend health">
          <Server size={14} />
          <span>{backend.online ? "Online" : "Offline"}</span>
          {backend.online && backend.pingMs != null && <span className="opacity-80">· {backend.pingMs}ms</span>}
        </Chip>
      </div>
    </div>
  );
}
