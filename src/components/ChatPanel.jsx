import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { Send, Play, Pause, Download, Headphones } from "lucide-react";
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

async function podcastPreview(payload) {
  const r = await fetch(`${API_BASE}/api/podcast/from-selection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Podcast preview ${r.status}`);
  return r.json();
}

async function podcastSpeak(payload) {
  const r = await fetch(`${API_BASE}/api/podcast/from-selection/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Podcast audio ${r.status}`);
  return r.blob(); // audio/mpeg or wav (fallback)
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

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function AudioPlayer({ src, onDownload }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onLoaded = () => setDuration(a.duration || 0);
    const onTime = () => { if (!seeking) setCurrent(a.currentTime || 0); };
    const onEnd = () => setPlaying(false);

    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, [seeking]);

  // Autoplay when a new src arrives
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !src) return;
    setPlaying(true);
    a.play().catch(() => setPlaying(false));
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const pct = duration ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;

  return (
    <div className="w-full rounded-xl bg-white/5 p-3">
      {/* hidden native audio element */}
      <audio ref={audioRef} src={src ?? undefined} preload="metadata" />

      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          disabled={!src}
          className={cls(
            "shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full",
            "bg-white/90 hover:bg-white text-neutral-900",
            !src && "opacity-60 cursor-not-allowed"
          )}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>

        {/* scrubber */}
        <div className="flex-1">
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={seeking ? undefined : current}
            onChange={(e) => {
              setSeeking(true);
              setCurrent(Number(e.target.value));
            }}
            onMouseUp={(e) => {
              const a = audioRef.current;
              const t = Number(e.target.value);
              if (a) a.currentTime = t;
              setSeeking(false);
            }}
            onTouchEnd={(e) => {
              const a = audioRef.current;
              const t = Number(e.target.value);
              if (a) a.currentTime = t;
              setSeeking(false);
            }}
            className="w-full appearance-none bg-transparent"
            style={{
              background: `linear-gradient(to right, rgba(255,255,255,.7) ${pct}%, rgba(255,255,255,.12) ${pct}%)`,
              height: 4,
              borderRadius: 9999,
              outline: "none",
            }}
          />
          <div className="mt-1 flex justify-between text-[11px] text-slate-400">
            <span>{formatTime(current)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <button
          onClick={onDownload}
          disabled={!src}
          className={cls(
            "shrink-0 px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-100 text-xs border border-white/20",
            !src && "opacity-60 cursor-not-allowed"
          )}
        >
          <Download size={14} />
        </button>
      </div>
    </div>
  );
}

/* ---------- shared UI bits ---------- */

function Pill({ children }) {
  return <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-200 border border-white/20">{children}</span>;
}

function CtxRow({ ctx, activeFile }) {
  const title = `${niceName(ctx.pdf_name)} · p.${ctx.page}`;
  const canJump =
    activeFile?.name &&
    (ctx.pdf_name?.endsWith(activeFile.name) || niceName(ctx.pdf_name) === activeFile.name);

  const go = () => {
    if (!canJump) return;
    window.dispatchEvent(new CustomEvent("viewer:goto", { detail: { page: ctx.page, docId: activeFile.id } }));
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
          <CtxRow key={`${c.chunk_id || c.page}-${i}`} ctx={c} activeFile={activeFile} />
        ))}
      </div>
    </div>
  );
}

function InsightsCard({ selection, answer, buckets, activeFile }) {
  return (
    <div className="text-slate-100">
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <Pill>Insights</Pill>
        <span className="truncate">for "{selection?.slice(0, 120)}{selection?.length > 120 ? "…" : ""}"</span>
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
    <div className="sticky top-0 z-10 bg-transparent border-b border-white/10">
      <div className="px-3 pt-2">
        <div ref={wrapRef} role="tablist" aria-label="Panels" className="relative" onKeyDown={onKeyDown}>
          <div aria-hidden className="absolute left-0 right-0 bottom-0 h-px bg-white/10" />
          <div aria-hidden className="absolute bottom-0 h-0.5 bg-slate-300 rounded-full transition-all duration-300 ease-out"
               style={{ left: indicator.left, width: indicator.width }} />
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

/* ---------- Podcast UI ---------- */

function TurnLine({ t }) {
  const color = t.speaker === "A" ? "bg-white/5" : "bg-neutral-800";
  return (
    <div className={cls("rounded-xl px-3 py-2 text-sm border", color, "border-white/15")}>
      <span className="font-semibold text-slate-200 mr-2">{t.speaker}:</span>
      <span className="text-slate-100">{t.text}</span>
    </div>
  );
}

function SourceList({ contexts, activeFile }) {
  if (!contexts?.length) return null;
  return (
    <div className="mt-4">
      <div className="text-xs font-semibold text-slate-200 mb-1">References & Context</div>
      <div className="space-y-2">
        {contexts.map((c, i) => <CtxRow key={`ctx-${i}`} ctx={c} activeFile={activeFile} />)}
      </div>
    </div>
  );
}

function PodcastPanel({ activeFile, lastSelection }) {
  const [selection, setSelection] = useState(lastSelection || "");
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState(null);

  const [audioUrl, setAudioUrl] = useState(null);
  const [contexts, setContexts] = useState([]);
  const audioRef = useRef(null);

  // keep selection in sync with the viewer (same as Insights)
  useEffect(() => {
    function handleAnchor(e) {
      const t = (e.detail?.text || "").trim();
      if (t) setSelection(t);
    }
    window.addEventListener("doc-anchor", handleAnchor);
    return () => window.removeEventListener("doc-anchor", handleAnchor);
  }, []);
  useEffect(() => { if (lastSelection) setSelection(lastSelection); }, [lastSelection]);

  // cleanup blob url
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  async function podcastPreview(payload) {
    const r = await fetch(`${API_BASE}/api/podcast/from-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`Podcast preview ${r.status}`);
    return r.json();
  }
  async function podcastSpeak(payload) {
    const r = await fetch(`${API_BASE}/api/podcast/from-selection/audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`Podcast audio ${r.status}`);
    return r.blob();
  }

  async function generate() {
    const sel = (selection || "").trim();
    if (!sel) {
      setError("Select text in the PDF first (same as Insights).");
      return;
    }
    setError(null);
    setIsWorking(true);
    setContexts([]);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    // fixed params: 3 minutes, Top-K 7, default voices (not sent)
    const payload = { selection: sel, top_k: 7, minutes: 3 };

    try {
      // fetch contexts to show references
      const preview = await podcastPreview(payload);
      setContexts(preview.contexts || []);

      // synthesize + autoplay
      const blob = await podcastSpeak(payload);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setTimeout(() => audioRef.current?.play?.(), 60);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setIsWorking(false);
    }
  }

  const download = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = "podcast.mp3";
    a.click();
  };

  return (
    <div className="rounded-xl px-4 py-8 bg-white/10 text-slate-100 border border-white/20">
      {/* centered hero */}
      <div className="flex flex-col items-center text-center">
        <div className="rounded-2xl p-5 bg-white/5 border border-white/20">
          <Headphones size={64} />
        </div>

        <div className="mt-3 text-sm text-slate-300">
          Turn your current selection into a 2-voice episode
        </div>
        {/* <div className="text-xs text-slate-400">
          Defaults: <b>3 min</b> • <b>Top-K 7</b> • server voices
        </div> */}

        <button
          onClick={generate}
          disabled={isWorking}
          className={cls(
            "mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/90 hover:bg-white text-neutral-900 text-sm",
            isWorking && "opacity-60 cursor-not-allowed"
          )}
        >
          <Play size={16} />
          {isWorking ? "Working…" : "Generate Podcast"}
        </button>

        {error && <div className="text-xs text-red-300 mt-2">{error}</div>}
      </div>

      {/* player */}
      <div className="mt-4">
        <AudioPlayer src={audioUrl} onDownload={download} />
      </div>


      {/* References & Context */}
      {contexts?.length ? (
        <div className="mt-6">
          <div className="text-xs font-semibold text-slate-200 mb-1">References & Context</div>
          <div className="space-y-2">
            {contexts.map((c, i) => (
              <CtxRow key={`ctx-${i}`} ctx={c} activeFile={activeFile} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
/* ---------- main ---------- */

export default function ChatPanel({ activeFile }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your doc AI. Select text in the PDF to see overlapping, contradictory, examples, and more." },
  ]);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState("insights"); // "insights" | "podcast" | "chat"
  const [lastSelection, setLastSelection] = useState("");

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

  // listen to viewer selections -> "doc-anchor" events
  useEffect(() => {
    async function handleAnchor(e) {
      const { text } = e.detail || {};
      const sel = (text || "").trim();
      if (!sel) return;

      setLastSelection(sel);

      setMessages((m) => [
        ...m,
        { role: "user", content: `🔎 Selected: "${sel.length > 200 ? sel.slice(0, 200) + "…" : sel}"` },
      ]);

      try {
        const res = await ragQuery(sel, 10);
        const buckets = bucketize(sel, res.contexts || []);
        setMessages((m) => [
          ...m,
          { role: "assistant_insights", selection: sel, answer: res.answer, buckets },
        ]);
        // setTab("podcast"); // enable if you want auto-jump
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

  // free-typed questions
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
    return false; // podcast uses its own panel
  });

  return (
    <div className="h-full min-h-0 flex flex-col">
      <TopTabs tab={tab} setTab={setTab} />

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
          <PodcastPanel activeFile={activeFile} lastSelection={lastSelection} />
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
