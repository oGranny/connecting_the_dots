import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ChevronRight, ChevronDown, FileText, Loader2, Search } from "lucide-react";
import { cls } from "../lib/utils";

/**
 * Props:
 * - headings: [{ id, level:1..4, title, page, hidden? }]
 * - status: 'pending' | 'done' | 'error'
 * - onJumpToHeading(page:number)
 * - onFilter(q:string)
 *
 * New behavior (per request):
 * - H1 rows have a dropdown to reveal their section.
 * - Inside an expanded H1 section, **all H2 items are shown at the same indentation**,
 *   each H2 has its own dropdown to reveal its H3 children.
 * - H3 rows appear under the corresponding expanded H2, one more indent.
 */
export default function Sidebar({ headings = [], status, onJumpToHeading, onFilter }) {
  const [openBlocks, setOpenBlocks] = useState({ toc: true });
  const [expandedH1, setExpandedH1] = useState({}); // H1 id -> boolean
  const [expandedH2, setExpandedH2] = useState({}); // `${h1Id}:${h2Id}` -> boolean

  // Apply filter from parent (remove hidden)
  const visibleHeadings = useMemo(
    () => (headings || []).filter((h) => !h.hidden),
    [headings]
  );

  // Build "sections": H1 -> [H2 -> [H3+]]
  const sections = useMemo(() => groupSections(visibleHeadings), [visibleHeadings]);

  // When headings change, reset expansion (collapse everything by default)
  useEffect(() => {
    setExpandedH1({});
    setExpandedH2({});
  }, [sections]);

  const toggleToc = () => setOpenBlocks((o) => ({ ...o, toc: !o.toc }));
  const toggleH1 = useCallback((h1Id) => {
    setExpandedH1((prev) => ({ ...prev, [h1Id]: !prev[h1Id] }));
  }, []);
  const toggleH2 = useCallback((h1Id, h2Id) => {
    const key = `${h1Id}:${h2Id}`;
    setExpandedH2((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="p-3 select-none">
      {/* search/filter */}
      <div className="p-2 border border-slate-700 rounded-lg bg-slate-800/40 mb-3 flex items-center gap-2">
        <Search size={16} className="opacity-70" />
        <input
          placeholder="Filter headings…"
          className="bg-transparent outline-none text-xs flex-1 placeholder:text-slate-400"
          onChange={(e) => onFilter?.(e.target.value)}
        />
      </div>

      {/* status badges */}
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

      {/* TOC block */}
      <div className="mb-4">
        <button
          onClick={toggleToc}
          className="w-full flex items-center gap-2 text-slate-200 hover:text-white"
        >
          {openBlocks.toc ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="text-sm font-medium">Table of Contents</span>
        </button>

        {openBlocks.toc && (
          <div className="mt-2 pl-2">
            {status === "pending" && (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-6 rounded-md bg-slate-800/50 animate-pulse" />
                ))}
              </div>
            )}

            {status !== "pending" && (!sections || sections.length === 0) && (
              <div className="text-xs text-slate-400">No headings found.</div>
            )}

            {status !== "pending" && !!sections?.length && (
              <SectionsList
                sections={sections}
                expandedH1={expandedH1}
                expandedH2={expandedH2}
                onToggleH1={toggleH1}
                onToggleH2={toggleH2}
                onJump={onJumpToHeading}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function clampLevel(n) {
  const x = Number.isFinite(n) ? n : 1;
  return Math.min(4, Math.max(1, x));
}

function normalizeHeading(h, i) {
  const rawLevel = typeof h.level === "string" && /^h\d+$/i.test(h.level)
    ? Number(h.level.slice(1))
    : Number(h.level);
  return {
    id: h.id ?? `h-${i}`,
    title: String(h.title ?? h.text ?? "").trim(),
    page: Math.max(1, Number(h.page) || 1),
    level: clampLevel(rawLevel),
    hidden: !!h.hidden,
  };
}

/**
 * Normalize a flat, ordered list so that:
 *  1) Root always begins with level 1 (promote leading H2/H3 to H1)
 *  2) Levels never jump by more than +1 (e.g., H1 -> H3 becomes H2)
 * Keeps the original order and content.
 */
function normalizeSequence(headings) {
  const hs = (headings || [])
    .map(normalizeHeading)
    .filter((h) => h.title.length > 0 && !h.hidden)
    .map((h) => ({ ...h }));

  let lastLevel = 0; // 0 = none
  for (const h of hs) {
    let lvl = clampLevel(h.level);
    if (lastLevel === 0 && lvl > 1) lvl = 1;           // start at H1
    if (lastLevel > 0 && lvl > lastLevel + 1) lvl = lastLevel + 1; // prevent skips
    h.level = lvl;
    lastLevel = lvl;
  }
  return hs;
}

/**
 * Group into sections so that ALL H2 are one consistent indentation under their nearest H1,
 * and H3/H4 belong to their most recent H2.
 * Returns: [{ h1, children: [{ h2, children: [h3+] }, ...] }, ...]
 */
function groupSections(headings) {
  const hs = normalizeSequence(headings);
  const sections = [];
  let section = null;
  let lastH2 = null;

  for (const h of hs) {
    if (h.level === 1) {
      section = { id: h.id, h1: h, children: [] };
      sections.push(section);
      lastH2 = null;
    } else if (h.level === 2) {
      if (!section) {
        section = { id: `sec-${h.id}`, h1: { ...h, level: 1 }, children: [] };
        sections.push(section);
      }
      const node2 = { ...h, children: [] };
      section.children.push(node2);
      lastH2 = node2;
    } else {
      // H3/H4 -> attach under the most recent H2 inside this section
      if (section && lastH2) {
        lastH2.children.push(h);
      }
    }
  }
  return sections;
}

/* -------------- renderers -------------- */

function SectionsList({ sections, expandedH1, expandedH2, onToggleH1, onToggleH2, onJump }) {
  if (!sections?.length) return null;
  return (
    <ul className="space-y-1">
      {sections.map((sec) => (
        <SectionItem
          key={sec.id}
          section={sec}
          expanded={!!expandedH1[sec.id]}
          expandedH2={expandedH2}
          onToggle={() => onToggleH1(sec.id)}
          onToggleH2={onToggleH2}
          onJump={onJump}
        />
      ))}
    </ul>
  );
}

function SectionItem({ section, expanded, expandedH2, onToggle, onToggleH2, onJump }) {
  const h1 = section.h1;

  return (
    <li>
      {/* H1 row */}
      <div
        className={cls(
          "group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/5",
          "bg-slate-800/60"
        )}
        style={{ paddingLeft: 8 }}
      >
        <button
          onClick={onToggle}
          className="h-6 w-6 grid place-items-center rounded hover:bg-white/10"
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className="h-6 w-6 grid place-items-center text-slate-300 opacity-80">
          <FileText size={16} />
        </div>

        <button
          onClick={() => onJump?.(h1.page)}
          className="flex-1 text-left inline-flex items-center gap-2"
          title={`Go to page ${h1.page}`}
        >
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-slate-200">
            H1
          </span>
          <span className="text-slate-100 text-sm truncate">{h1.title}</span>
        </button>
      </div>

      {/* H2/H3 inside the section */}
      {expanded && section.children?.length > 0 && (
        <ul className="mt-1 space-y-1">
          {section.children.map((h2) => {
            const k = `${section.id}:${h2.id}`;
            const open = !!expandedH2[k];
            const hasH3 = Array.isArray(h2.children) && h2.children.length > 0;
            return (
              <li key={h2.id}>
                {/* H2 row (dropdown only if it has H3 children) */}
                <div
                  className={cls(
                    "group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/5",
                    "bg-slate-800/30"
                  )}
                  style={{ paddingLeft: 22 }} // fixed one-level indent for all H2
                >
                  {hasH3 ? (
                    <button
                      onClick={() => onToggleH2(section.id, h2.id)}
                      className="h-6 w-6 grid place-items-center rounded hover:bg-white/10"
                      title={open ? "Collapse" : "Expand"}
                      aria-label={open ? "Collapse H2" : "Expand H2"}
                    >
                      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  ) : (
                    // spacer to align rows when there is no dropdown
                    <span className="h-6 w-6" />
                  )}

                  <div className="h-6 w-6 grid place-items-center text-slate-300 opacity-80">
                    <FileText size={16} />
                  </div>
                  <button
                    onClick={() => onJump?.(h2.page)}
                    className="flex-1 text-left inline-flex items-center gap-2"
                    title={`Go to page ${h2.page}`}
                  >
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-slate-200">
                      H2
                    </span>
                    <span className="text-slate-100 text-sm truncate">{h2.title}</span>
                  </button>
                </div>

                {/* H3 rows under this H2, shown only when H2 is expanded */}
                {hasH3 && open && (
                  <ul className="mt-1 space-y-1">
                    {h2.children.map((h3) => (
                      <li key={h3.id}>
                        <div
                          className={cls(
                            "group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/5",
                            "bg-slate-800/10"
                          )}
                          style={{ paddingLeft: 38 }} // one more indent than H2
                        >
                          {/* spacer to align with H2 chevron */}
                          <span className="h-6 w-6" />
                          <div className="h-6 w-6 grid place-items-center text-slate-300 opacity-80">
                            <FileText size={16} />
                          </div>
                          <button
                            onClick={() => onJump?.(h3.page)}
                            className="flex-1 text-left inline-flex items-center gap-2"
                            title={`Go to page ${h3.page}`}
                          >
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-slate-200">
                              H{Math.min(3, h3.level || 3)}
                            </span>
                            <span className="text-slate-100 text-sm truncate">{h3.title}</span>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
