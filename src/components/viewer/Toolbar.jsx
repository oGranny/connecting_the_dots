import React from "react";

export function Segment({ children, title }) {
  return (
    <div
      className="inline-flex items-center rounded-2xl overflow-hidden border border-white/10 bg-white/5"
      aria-label={title}
    >
      {children}
    </div>
  );
}

export function SegButton({ active, onClick, icon, label, hint }) {
  return (
    <button
      onClick={onClick}
      className={`h-9 px-3 flex items-center gap-2 text-sm ${
        active ? "bg-white/15 text-slate-100" : "text-slate-200 hover:bg-white/10"
      }`}
      title={hint ? (label ? `${label} (${hint})` : hint) : label}
    >
      {icon}
      {label ? <span className="hidden sm:inline">{label}</span> : null}
    </button>
  );
}

export function IconButton({ children, onClick, disabled, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-9 w-9 grid place-items-center border-l border-white/10 first:border-l-0
        ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-white/10"}
        text-slate-200`}
    >
      {children}
    </button>
  );
}
