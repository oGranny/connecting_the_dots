import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { Send } from "lucide-react";
import { cls } from "../lib/utils";
import { API_BASE } from "../services/api";

/* ---------- helpers ---------- */

async function ragQuery(q, top_k = 10) {
  const r = await fetch(`${API_BASE}/api/rag/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, top_k }),
  });
  if (!r.ok) throw new Error(`RAG ${r.status}`);
  return r.json();
}

function niceName(pdf_name = "") {
  const parts = pdf_name.split("_");
  if (parts.length > 1) return parts.slice(1).join("_");
  return pdf_name || "document.pdf";
}

function looksLikeExample(t = "") {
  return /\b(e\.g\.|for example|for instance|example:|e\.g,)\b/i.test(t) || /\d{2,}/.test(t) || /•|- |\d+\)/.test(t);
}
function looksLikeDefinition(t = "") {
  return /\b(is defined as|refers to|means\b|definition of)\b/i.test(t);
}
function looksLikeContradiction(t = "") {
  return /\b(however|but|in contrast|whereas|on the other hand|contradict|conflict|opposite)\b/i.test(t);
}

function bucketize(selection, contexts = []) {
  if (!contexts?.length) {
    return { overlapping: [], contradictory: [], examples: [], definitions: [], related: [] };
  }
  const byScore = [...contexts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const cutoff = byScore[Math.max(0, Math.floor(byScore.length * 0.3) - 1)]?.score ?? 0;

  const buckets = { overlapping: [], contradictory: [], examples: [], definitions: [], related: [] };
  for (const c of contexts) {
    const txt = (c.text || "").trim();
    if ((c.score ?? 0) >= cutoff) { buckets.overlapping.push(c); continue; }
    if (looksLikeContradiction(txt)) { buckets.contradictory.push(c); continue; }
    if (looksLikeExample(txt)) { buckets.examples.push(c); continue; }
    if (looksLikeDefinition(txt)) { buckets.definitions.push(c); continue; }
    buckets.related.push(c);
  }
  return buckets;
}

/* ---------- UI pieces ---------- */

function Pill({ children }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-200 border border-white/20">
      {children}
    </span>
  );
}

function CtxRow({ ctx, activeFile }) {
  const title = `${niceName(ctx.pdf_name)} · p.${ctx.page}`;
  const canJump =
    activeFile?.name &&
    (ctx.pdf_name?.endsWith(activeFile.name) || niceName(ctx.pdf_name) === activeFile.name);

  const go = () => {
    if (!canJump) return;
    window.dispatchEvent(
      new CustomEvent("viewer:goto", { detail: { page: ctx.page, docId: activeFile.id } })
    );
  };

  return (
    <div className="p-2 rounded-xl bg-white/5 border border-white/20">
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <span className="font-medium">{title}</span>
        {typeof ctx.score === "number" && (
          <span className="ml-auto text-[10px] text-slate-400">score {ctx.score.toFixed(3)}</span>
        )}
      </div>
      <div className="mt-1 text-sm text-slate-200 whitespace-pre-wrap">
        {ctx.text?.length > 600 ? ctx.text.slice(0, 600) + "…" : ctx.text}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {canJump ? (
          <button
            onClick={go}
            className="text-xs px-2 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-slate-100"
            title="Jump to this page in the viewer"
          >
            Go to page
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">Open this PDF to enable jumping</span>
        )}
      </div>
    </div>
  );
}

function BucketBlock({ title, items, activeFile }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-semibold text-slate-200">{title}</div>
      <div className="space-y-2">
        {items.map((c, i) => (
          <CtxRow key={`${c.chunk_id}-${i}`} ctx={c} activeFile={activeFile} />
        ))}
      </div>
    </div>
  );
}

function InsightsCard({ selection, answer, buckets, activeFile }) {
  return (
    <div className="rounded-xl px-3 py-2 bg-white/10 text-slate-100 border border-white/20">
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <Pill>Insights</Pill>
        <span className="truncate">
          for "{selection?.slice(0, 120)}{selection?.length > 120 ? "…" : ""}"
        </span>
      </div>

      {answer && (
        <div className="mt-2 p-2 rounded-xl bg-white/5 border border-white/20 text-sm whitespace-pre-wrap">
          {answer}
        </div>
      )}

      <BucketBlock title="Overlapping / Closest" items={buckets.overlapping} activeFile={activeFile} />
      <BucketBlock title="Contradictory viewpoints" items={buckets.contradictory} activeFile={activeFile} />
      <BucketBlock title="Examples & use-cases" items={buckets.examples} activeFile={activeFile} />
      <BucketBlock title="Definitions" items={buckets.definitions} activeFile={activeFile} />
      <BucketBlock title="Related" items={buckets.related} activeFile={activeFile} />
    </div>
  );
}

/** Monochrome underline tabs */
function TopTabs({ tab, setTab }) {
  const tabs = [
    { id: "insights", label: "Insights" },
    { id: "podcast", label: "Podcast" },
    { id: "chat", label: "Chat" },
  ];
  const wrapRef = useRef(null);
  const btnRefs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    const wrap = wrapRef.current;
    const btn = btnRefs.current[tab];
    if (!wrap || !btn) return;
    const wRect = wrap.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    setIndicator({ left: bRect.left - wRect.left, width: bRect.width });
  }, [tab]);

  useLayoutEffect(() => { updateIndicator(); }, [updateIndicator]);
  useEffect(() => {
    const onResize = () => updateIndicator();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateIndicator]);

  const onKeyDown = (e) => {
    const idx = tabs.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight") {
      const next = tabs[(idx + 1) % tabs.length].id;
      setTab(next);
      requestAnimationFrame(updateIndicator);
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length].id;
      setTab(prev);
      requestAnimationFrame(updateIndicator);
      e.preventDefault();
    }
  };

  return (
    <div className="sticky top-0 z-10 bg-black/30 backdrop-blur supports-[backdrop-filter]:bg-black/20">
      <div className="px-3 pt-2">
        <div
          ref={wrapRef}
          role="tablist"
          aria-label="Panels"
          className="relative"
          onKeyDown={onKeyDown}
        >
          {/* baseline */}
          <div aria-hidden className="absolute left-0 right-0 bottom-0 h-px bg-white/10" />
          {/* active indicator */}
          <div
            aria-hidden
            className="absolute bottom-0 h-0.5 bg-slate-300 rounded-full transition-all duration-300 ease-out"
            style={{ left: indicator.left, width: indicator.width }}
          />
          {/* buttons */}
          <div className="flex gap-1">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  ref={(el) => (btnRefs.current[t.id] = el)}
                  role="tab"
                  aria-selected={active}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={cls(
                    "relative z-10 px-4 py-2 text-sm font-medium outline-none transition-colors",
                    active ? "text-white" : "text-slate-300 hover:text-white"
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- main ---------- */

export default function ChatPanel({ activeFile }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I'm your doc AI. Select text in the PDF to see overlapping, contradictory, examples, and more.",
    },
  ]);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState("insights");
  const viewRef = useRef(null);

  // drag-to-scroll
  const dragRef = useRef({ active: false, x: 0, y: 0, sl: 0, st: 0 });
  function onMouseDown(e) {
    if (e.button !== 0) return;
    const el = viewRef.current;
    if (!el) return;
    const tag = e.target?.tagName?.toLowerCase();
    if (["input", "textarea", "button"].includes(tag)) return;
    dragRef.current = { active: true, x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    el.classList.add("cursor-grabbing", "select-none");
    el.classList.remove("cursor-grab");
  }
  function onMouseMove(e) {
    const el = viewRef.current;
    const s = dragRef.current;
    if (!el || !s.active) return;
    if ((e.buttons & 1) === 0) return endDrag();
    e.preventDefault();
    el.scrollLeft = s.sl - (e.clientX - s.x);
    el.scrollTop = s.st - (e.clientY - s.y);
  }
  function endDrag() {
    const el = viewRef.current;
    dragRef.current.active = false;
    if (!el) return;
    el.classList.add("cursor-grab");
    el.classList.remove("cursor-grabbing", "select-none");
  }

  // auto-scroll on new messages or tab switch
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, tab]);

  // listen to "doc-anchor" events
  useEffect(() => {
    async function handleAnchor(e) {
      const { text } = e.detail || {};
      const sel = (text || "").trim();
      if (!sel) return;

      setMessages((m) => [
        ...m,
        { role: "user", content: `🔎 Selected: "${sel.length > 200 ? sel.slice(0, 200) + "…" : sel}"` },
      ]);

      try {
        const res = await ragQuery(sel, 10);
        const buckets = bucketize(sel, res.contexts || []);
        setMessages((m) => [
          ...m,
          {
            role: "assistant_insights",
            selection: sel,
            answer: res.answer,
            buckets,
          },
        ]);
      } catch (err) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `Failed to fetch insights: ${String(err.message || err)}` },
        ]);
      }
    }
    window.addEventListener("doc-anchor", handleAnchor);
    return () => window.removeEventListener("doc-anchor", handleAnchor);
  }, []);

  // send free-typed questions
  const send = useCallback(async (text) => {
    const t = text.trim();
    if (!t) return;
    setMessages((m) => [...m, { role: "user", content: t }]);
    setInput("");
    try {
      const res = await ragQuery(t, 10);
      const buckets = bucketize(t, res.contexts || []);
      setMessages((m) => [
        ...m,
        { role: "assistant_insights", selection: t, answer: res.answer, buckets },
      ]);
      // setTab("insights");
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Failed to fetch: ${String(err.message || err)}` },
      ]);
    }
  }, []);

  const visible = messages.filter((m) => {
    if (tab === "insights") return m.role === "assistant_insights";
    if (tab === "chat") return m.role !== "assistant_insights";
    return false; // podcast doesn't use messages
  });

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Underline tabs */}
      <TopTabs tab={tab} setTab={setTab} />

      {/* body */}
      <div
        ref={viewRef}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 cursor-grab no-scrollbar"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${tab}-tab`}
      >
        {tab === "podcast" ? (
          <div className="rounded-xl px-4 py-6 bg-white/10 text-slate-100 border border-white/20">
            <div className="text-sm text-slate-300 mb-2">Podcast</div>
            <div className="text-sm">
              Build short audio episodes from selected text or across PDFs.
            </div>
          </div>
        ) : tab === "insights" ? (
          visible.length ? (
            visible.map((m, i) => (
              <InsightsCard
                key={`ins-${i}`}
                selection={m.selection}
                answer={m.answer}
                buckets={m.buckets}
                activeFile={activeFile}
              />
            ))
          ) : (
            <div className="text-xs text-slate-400 px-2">
              No insights yet. Select text in the PDF or ask a question from the Chat tab.
            </div>
          )
        ) : (
          visible.map((m, i) => (
            <div
              key={`chat-${i}`}
              className={cls(
                "max-w-[92%] rounded-xl px-3 py-2 text-sm",
                m.role === "assistant"
                  ? "bg-white/10 text-slate-100 border border-white/20"
                  : "bg-neutral-800 text-slate-100 ml-auto"
              )}
            >
              {m.content}
            </div>
          ))
        )}
      </div>

      {/* footer — only for Chat */}
      {tab === "chat" && (
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              placeholder="Ask across your PDFs…"
              className="flex-1 bg-white/5 outline-none text-sm text-slate-100 placeholder:text-slate-400 px-3 py-2 rounded-xl border border-white/20 focus:ring-2 focus:ring-slate-500"
            />
            <button
              onClick={() => send(input)}
              className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-slate-100 flex items-center gap-2 text-sm"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
