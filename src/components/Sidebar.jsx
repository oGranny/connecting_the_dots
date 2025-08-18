import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Loader2, Search } from "lucide-react";
import { cls } from "../lib/utils";

function buildTree(headings = []) {
  const root = [];
  const stack = [];
  headings.forEach((h) => {
    const node = { ...h, children: [] };
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root.push(node);
    stack.push(node);
  });
  return root;
}

export default function Sidebar({ headings = [], status, onJumpToHeading, onFilter }) {
  const [open, setOpen] = useState({ toc: true });
  const [nodeOpen, setNodeOpen] = useState({}); // id -> boolean
  const tree = useMemo(() => buildTree(headings), [headings]);

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

  const Row = ({ node }) => {
    const hasChildren = node.children && node.children.length > 0;
    const isOpen = nodeOpen[node.id] ?? false;

    const lvlBg =
      node.level === 1 ? "bg-slate-800/60" : node.level === 2 ? "bg-slate-800/30" : "bg-slate-800/10";
    const indent = node.level === 1 ? "pl-0" : node.level === 2 ? "pl-3" : "pl-6";

    return (
      <div>
        <div
          className={cls(
            "px-2 py-1 rounded-md cursor-pointer flex items-center gap-2 hover:bg-slate-700/50",
            lvlBg,
            indent
          )}
          title={`Go to page ${node.page}`}
          onClick={() => onJumpToHeading?.(node.page)}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setNodeOpen((o) => ({ ...o, [node.id]: !(o[node.id] ?? true) }));
              }}
              className="flex-none inline-flex items-center justify-center w-4 h-4"
              aria-label={isOpen ? "Collapse" : "Expand"}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="flex-none inline-block w-4 h-4" />
          )}

          <span className="inline-flex items-center justify-center w-4 h-4 mr-1 flex-none leading-none">
            <FileText className="w-3.5 h-3.5 text-slate-300" strokeWidth={1.8} aria-hidden="true" />
          </span>

          <span className="text-xs truncate">H{node.level} · {node.title}</span>
        </div>

        {hasChildren && isOpen && (
          <div className="mt-1 space-y-1">
            {node.children.map((c) => (
              <Row key={c.id} node={c} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-3">
      <div className="p-2 border border-slate-700 rounded-lg bg-slate-800/40 mb-3 flex items-center gap-2">
        <Search size={16} className="opacity-70" />
        <input
          placeholder="Filter headings…"
          className="bg-transparent outline-none text-xs flex-1 placeholder:text-slate-400"
          onChange={(e) => onFilter?.(e.target.value)}
        />
      </div>

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

        {status !== "pending" &&
          tree.map((node) => <Row key={node.id} node={node} />)}
      </Section>
    </div>
  );
}
