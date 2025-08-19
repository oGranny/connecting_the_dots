import React, { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cls } from "../lib/utils";

export default function Sidebar({ headings = [], status, onJumpToHeading, onFilter, files = [], activeFileId, onSelectFileId }) {
  const [open, setOpen] = useState({ toc: true });

  const [expandedH1, setExpandedH1] = useState({}); // { [h1.id]: boolean }
  const [expandedH2, setExpandedH2] = useState({}); // { "secId:h2Id": boolean }
  const onToggleH1 = (id) => setExpandedH1((s) => ({ ...s, [id]: !s[id] }));
  const onToggleH2 = (secId, h2Id) =>
    setExpandedH2((s) => {
      const k = `${secId}:${h2Id}`;
      return { ...s, [k]: !s[k] };
    });

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

        {status !== "pending" && headings && headings.length > 0 && (
          <SectionsList
            sections={groupSections(headings)}
            expandedH1={expandedH1}
            expandedH2={expandedH2}
            onToggleH1={onToggleH1}
            onToggleH2={onToggleH2}
            onJump={onJumpToHeading}
          />
        )}
      </Section>

      <Section id="files" title="Files">
        {Array.isArray(files) && files.length > 0 ? (
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => onSelectFileId && onSelectFileId(f.id)}
                  title={f.name}
                  className={cls(
                    "w-full text-left px-2 py-1 rounded-md border border-white/5 bg-white/5 hover:bg-white/10 text-[13px] truncate",
                    activeFileId === f.id && "ring-1 ring-white/30"
                  )}
                >
                  <span className="truncate block">{f.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-slate-400">No files uploaded.</div>
        )}
      </Section>
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
  const hasChildren = Array.isArray(section.children) && section.children.length > 0;

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
        {hasChildren ? (
          <button
            onClick={onToggle}
            className="h-6 w-6 grid place-items-center rounded hover:bg-white/10"
            title={expanded ? "Collapse" : "Expand"}
            aria-label={expanded ? "Collapse section" : "Expand section"}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="h-6 w-6" />
        )}

        <button
          onClick={() => onJump?.(h1.page)}
          className="flex-1 text-left inline-flex items-center gap-2"
          title={`Go to page ${h1.page}`}
        >
          <span
            className="text-slate-100 text-sm leading-snug block overflow-hidden"
            title={h1.title}
            style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}
          >
            {h1.title}
          </span>
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
                {/* H2 row (dropdown removed) */}
                <div
                  className={cls(
                    "group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/5",
                    "bg-slate-800/30"
                  )}
                  style={{ paddingLeft: 16 }} // reduced indent for H2
                >
                  <span className="h-6 w-6" />

                  <button
                    onClick={() => onJump?.(h2.page)}
                    className="flex-1 text-left inline-flex items-center gap-2"
                    title={`Go to page ${h2.page}`}
                  >
                    <span
                      className="text-slate-100 text-sm leading-snug block overflow-hidden"
                      title={h2.title}
                      style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}
                    >
                      {h2.title}
                    </span>
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
                          style={{ paddingLeft: 28 }} // reduced indent for H3
                        >
                          {/* spacer to align with H2 chevron */}
                          <span className="h-6 w-6" />
                          <button
                            onClick={() => onJump?.(h3.page)}
                            className="flex-1 text-left inline-flex items-center gap-2"
                            title={`Go to page ${h3.page}`}
                          >
                            <span
                              className="text-slate-100 text-sm leading-snug block overflow-hidden"
                              title={h3.title}
                              style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}
                            >
                              {h3.title}
                            </span>
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
