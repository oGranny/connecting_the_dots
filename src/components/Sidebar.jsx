import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Loader2, File } from "lucide-react";
import { cls } from "../lib/utils";

export default function Sidebar({
  headings = [],
  status,
  onJumpToHeading,
  onFilter,            // kept for future use
  files = [],
  activeFileId,
  onFileSelect,
}) {
  const [open, setOpen] = useState({ toc: true, files: true });
  const [expanded, setExpanded] = useState({}); // collapsed by default

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

  // Build H1 -> H2 -> H3 tree
  const tree = useMemo(() => {
    const root = [];
    let lastH1 = null;
    let lastH2 = null;

    (headings || []).forEach((h) => {
      const node = { ...h, children: [] };

      if (h.level === 1) {
        root.push(node);
        lastH1 = node;
        lastH2 = null;
        return;
      }

      if (h.level === 2) {
        if (!lastH1) {
          const misc = {
            id: "__misc_h1__",
            title: "Other",
            level: 1,
            page: h.page,
            children: [],
          };
          root.push(misc);
          lastH1 = misc;
        }
        lastH1.children.push(node);
        lastH2 = node;
        return;
      }

      if (h.level === 3) {
        if (lastH2) lastH2.children.push(node);
        else if (lastH1) lastH1.children.push(node);
        else {
          const misc = {
            id: "__misc_h1__",
            title: "Other",
            level: 1,
            page: h.page,
            children: [node],
          };
          root.push(misc);
          lastH1 = misc;
          lastH2 = null;
        }
        return;
      }

      if (lastH2) lastH2.children.push(node);
      else if (lastH1) lastH1.children.push(node);
      else root.push(node);
    });

    return root;
  }, [headings]);

  const toggle = (id) => setExpanded((m) => ({ ...m, [id]: !m[id] }));

  return (
    <div className="p-3">
      {status === "pending" && (
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-300 bg-white/5 border border-white/10 rounded-md px-2 py-1">
          <Loader2 className="animate-spin" size={14} /> Analyzing headings…
        </div>
      )}
      {status === "error" && (
        <div className="mb-3 text-xs text-red-300 bg-red-900/20 border border-red-700/40 rounded-md px-2 py-1">
          Heading detection failed (check backend).
        </div>
      )}

      <Section id="toc" title="Table of Contents">
        {status === "pending" && (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-5 rounded bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {status !== "pending" && (!headings || headings.length === 0) && (
          <div className="text-xs text-slate-400">No headings found.</div>
        )}

        {tree.map((h1) => {
          const isOpenH1 = !!expanded[h1.id]; // collapsed by default
          return (
            <div key={h1.id} className="rounded-md">
              {/* H1 row */}
              <div className="group flex items-center gap-2 px-1.5 py-1 rounded cursor-default">
                <button
                  className="p-0.5 rounded hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(h1.id);
                  }}
                  aria-label={isOpenH1 ? "Collapse section" : "Expand section"}
                >
                  {isOpenH1 ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <span className="inline-flex items-center justify-center w-4 h-4 mr-1 flex-none">
                  <FileText className="w-3.5 h-3.5 text-slate-300" strokeWidth={1.8} aria-hidden="true" />
                </span>
                <button
                  className="text-xs truncate text-slate-200 hover:text-white flex-1 text-left"
                  onClick={() => onJumpToHeading?.(h1.page)}
                  title={`Go to page ${h1.page}`}
                >
                  {h1.title}
                </button>
                {/* subtle left guide on hover/active */}
              </div>

              {/* H2 list */}
              {isOpenH1 && h1.children?.length > 0 && (
                <div className="mt-0.5 ml-4 space-y-0.5">
                  {h1.children.map((h2) => {
                    const isOpenH2 = !!expanded[h2.id]; // collapsed by default
                    return (
                      <div key={h2.id}>
                        <div className="group flex items-center gap-2 px-1.5 py-1 rounded cursor-default">
                          <button
                            className="p-0.5 rounded hover:bg-white/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(h2.id);
                            }}
                            aria-label={isOpenH2 ? "Collapse subsection" : "Expand subsection"}
                          >
                            {isOpenH2 ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <button
                            className="text-xs truncate text-slate-300 hover:text-slate-100 flex-1 text-left"
                            onClick={() => onJumpToHeading?.(h2.page)}
                            title={`Go to page ${h2.page}`}
                          >
                            {h2.title}
                          </button>
                        </div>

                        {/* H3 list */}
                        {isOpenH2 && h2.children?.length > 0 && (
                          <div className="mt-0.5 ml-4">
                            {h2.children.map((h3) => (
                              <button
                                key={h3.id}
                                className="w-full text-left text-xs truncate px-1.5 py-1 rounded hover:bg-white/5 text-slate-400 hover:text-slate-100"
                                onClick={() => onJumpToHeading?.(h3.page)}
                                title={`Go to page ${h3.page}`}
                              >
                                {h3.title}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <Section id="files" title="Files">
        {(!files || files.length === 0) && <div className="text-xs text-slate-400">No files loaded.</div>}

        {files?.map((file) => (
          <button
            key={file.id}
            onClick={() => onFileSelect?.(file.id)}
            className={cls(
              "w-full text-left px-2 py-1 rounded flex items-center gap-2 hover:bg-white/5",
              activeFileId === file.id ? "text-white" : "text-slate-300"
            )}
            title={`Switch to ${file.name}`}
          >
            <span className="inline-flex items-center justify-center w-4 h-4 mr-2 flex-none">
              <File className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="text-xs truncate">{file.name}</span>
          </button>
        ))}
      </Section>
    </div>
  );
}
