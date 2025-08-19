import React, { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { cls } from "../../lib/utils";
import TopTabs from "./components/TopTabs";
import PodcastPanel from "./components/PodcastPanel";
import { InsightsCard, InsightsLoading } from "./components/Insights";
import { ragQuery, ragQueryHybrid, bucketize, openPdfAt, niceName } from "./lib/helpers";
import "./rightpanel.css";
import { MessageCircle, Search } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function ChatPanel({ activeFile, onFileSelect, files }) {
  const MD = useCallback(
    ({ children }) => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" className="underline" />,
          code: ({ inline, className, children, ...props }) =>
            inline ? (
              <code className="px-1 py-0.5 rounded bg-white/10 border border-white/10" {...props}>
                {children}
              </code>
            ) : (
              <pre className="p-3 rounded-xl bg-black/40 border border-white/10 overflow-auto" {...props}>
                <code className={className}>{children}</code>
              </pre>
            ),
          ul: (props) => <ul className="list-disc pl-5 space-y-1" {...props} />,
          ol: (props) => <ol className="list-decimal pl-5 space-y-1" {...props} />,
          p: (props) => <p className="my-2" {...props} />,
          h1: (props) => <h1 className="text-lg font-semibold mt-2 mb-1" {...props} />,
          h2: (props) => <h2 className="text-base font-semibold mt-2 mb-1" {...props} />,
          h3: (props) => <h3 className="text-sm font-semibold mt-2 mb-1" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    ),
    []
  );

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I'm your doc AI. Select text in the PDF to see overlapping, contradictory, examples, and more.",
    },
  ]);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState("insights");
  const [lastSelection, setLastSelection] = useState("");
  const [podcastWorking, setPodcastWorking] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const viewRef = useRef(null);
  const inputRef = useRef(null);

  // auto-scroll on new messages or tab switch (skip podcast)
  useEffect(() => {
    if (tab === "podcast") return;
    const el = viewRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, [messages, tab]);

  // focus input when switching to Chat tab
  useEffect(() => {
    if (tab === "chat") {
      inputRef.current?.focus();
    }
  }, [tab]);

  // --- Single doc-anchor listener (with contexts for rank-click open/highlight)
  useEffect(() => {
    async function handleAnchor(e) {
      const { text: selRaw } = e.detail || {};
      const sel = (selRaw || "").trim();
      if (!sel) return;

      setLastSelection(sel);

      // Clear old insights immediately
      setMessages((m) => m.filter((msg) => msg.role !== "assistant_insights"));

      setInsightsLoading(true);

      setMessages((m) => [
        ...m,
        {
          role: "user",
          content: `🔎 Selected: "${sel.length > 200 ? sel.slice(0, 200) + "…" : sel}"`,
        },
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
            contexts: res.contexts || [], // pass contexts so [rank] clicks can jump/highlight
          },
        ]);
      } catch (err) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `Failed to fetch insights: ${String(err.message || err)}` },
        ]);
      } finally {
        setInsightsLoading(false);
      }
    }

    window.addEventListener("doc-anchor", handleAnchor);
    return () => window.removeEventListener("doc-anchor", handleAnchor);
  }, []);

  // --- define handleSend FIRST so other handlers can use it
  const handleSend = useCallback(
    async () => {
      const text = input.trim();
      if (!text || insightsLoading) return;

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setInput("");
      setInsightsLoading(true);

      try {
        if (tab === "chat") {
          const res = await ragQueryHybrid(text, {
            // optional tuning:
            // top_k: 10,
            // conf_threshold: 0.7,
            // max_snippets_total: 12,
            // max_snippets_per_pdf: 5,
          });

          setMessages((prev) => [
            ...prev,
            {
              role: "assistant_hybrid",
              content: res.answer || "I couldn't find relevant information in the documents.",
              meta: res._meta || {},
              mode: res.mode || "unknown",
              contexts: res.contexts || [],
              snippets: res.snippets || [],
              query: res.query,
            },
          ]);
        } else {
          // Insights (classic)
          const res = await ragQuery(text, 10);
          const buckets = bucketize(text, res.contexts || []);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant_insights",
              selection: text,
              answer: res.answer,
              buckets,
              contexts: res.contexts || [], // needed for [rank] -> open/highlight
            },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Failed to fetch: ${String(err.message || err)}` },
        ]);
      } finally {
        setInsightsLoading(false);
      }
    },
    [input, tab, insightsLoading]
  );

  // input handlers (AFTER handleSend)
  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
  }, []);

  const handleKeyDown = useCallback(
    (e) => {
      // prevent space from bubbling to viewer
      if (e.key === " " || e.code === "Space" || e.key === "Spacebar") {
        e.stopPropagation();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // visible messages per tab
  const visible = messages.filter((m) => {
    if (tab === "insights") return m.role === "assistant_insights";
    if (tab === "chat") return m.role !== "assistant_insights";
    return false;
  });

  return (
    <div className="h-full min-h-0 flex flex-col">
      <TopTabs tab={tab} setTab={setTab} podcastWorking={podcastWorking} />

      <div
        ref={viewRef}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 themed-scroll"
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${tab}-tab`}
      >
        {/* PODCAST PANEL */}
        <div hidden={tab !== "podcast"}>
          <PodcastPanel
            activeFile={activeFile}
            lastSelection={lastSelection}
            onWorkingChange={setPodcastWorking}
          />
        </div>

        {/* INSIGHTS PANEL */}
        <div hidden={tab !== "insights"}>
          {insightsLoading && <InsightsLoading />}
          {visible.length ? (
            <div className="space-y-4">
              {visible.map((m, i) => (
                <InsightsCard
                  key={`ins-${i}`}
                  selection={m.selection}
                  answer={m.answer}
                  buckets={m.buckets}
                  contexts={m.contexts}
                  activeFile={activeFile}
                  onFileSelect={onFileSelect}
                  files={files}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-2 px-4">
              <div className="rounded-2xl p-5 bg-white/5 border border-white/20 mb-4">
                <Search size={64} className="text-slate-300" />
              </div>
              <h3 className="text-lg font-semibold text-slate-200 mb-2">Select text to get insights</h3>
              <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
                Highlight a sentence in the PDF to see overlaps, contradictions, and examples.
              </p>
            </div>
          )}
        </div>

        {/* CHAT PANEL */}
        <div hidden={tab !== "chat"}>
          {insightsLoading && <InsightsLoading />}
          {visible.length ? (
            <div className="space-y-4">
              {visible.map((m, i) => {
                const isHybrid = m.role === "assistant_hybrid";
                if (!isHybrid) {
                  const isUser = m.role === "user";
                  return (
                    <div key={`chat-${i}`} className={cls("flex", isUser && "justify-end")}>
                      <div
                        className={cls(
                          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                          isUser
                            ? "bg-blue-600/20 text-slate-100 border border-blue-500/20 rounded-tr-md"
                            : "bg-white/5 text-slate-100 border border-white/10 rounded-tl-md"
                        )}
                      >
                        <MD>{m.content}</MD>
                      </div>
                    </div>
                  );
                }

                // assistant_hybrid bubble
                const rank1 = m.meta?.rank1_score;
                const thr = m.meta?.threshold;
                const tag = m.mode ? m.mode.replace("-", " ") : "hybrid";
                return (
                  <div key={`chat-h-${i}`} className="flex items-start">
                    <div className="max-w-[85%] bg-white/5 text-slate-100 border border-white/10 rounded-2xl rounded-tl-md px-4 py-3">
                      <div className="text-sm leading-relaxed">
                        <MD>{m.content}</MD>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                        <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15">{tag}</span>
                        {typeof rank1 === "number" && (
                          <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                            rank1: {rank1.toFixed(3)}
                          </span>
                        )}
                        {typeof thr === "number" && (
                          <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                            threshold: {thr}
                          </span>
                        )}
                      </div>

                      {!!m.contexts?.length && (
                        <div className="mt-3">
                          <div className="text-xs text-slate-400 mb-1">Top contexts</div>
                          <div className="space-y-2">
                            {m.contexts.slice(0, 3).map((c, idx) => (
                              <div key={c.chunk_id || idx} className="p-2 rounded-lg bg-white/5 border border-white/10">
                                <div className="flex items-center justify-between gap-3 text-xs">
                                  <div className="truncate">
                                    <span className="text-slate-300">[{c.rank}]</span>{" "}
                                    <span className="text-slate-200">{niceName(c.pdf_name)}</span>
                                    <span className="text-slate-400"> · p.{c.page}</span>
                                  </div>
                                  <button
                                    className="px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/20 text-[11px] text-slate-100 border border-white/15"
                                    onClick={() => openPdfAt(c.pdf_name, c.page)}
                                    title="Open in viewer"
                                  >
                                    Open
                                  </button>
                                </div>
                                {c.text && (
                                  <div className="mt-1 text-[12px] text-slate-300 line-clamp-3">{c.text}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {!!m.snippets?.length && (
                        <div className="mt-3">
                          <div className="text-xs text-slate-400 mb-1">Snippets used</div>
                          <ul className="space-y-1">
                            {m.snippets.slice(0, 4).map((s, idx) => (
                              <li key={s.chunk_id || idx} className="text-[12px] text-slate-300">
                                • {s.text?.slice(0, 160) || ""}
                                {s.text?.length > 160 ? "…" : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-8 px-4">
              <div className="rounded-2xl p-5 bg-white/5 border border-white/20 mb-4">
                <MessageCircle size={64} className="text-slate-300" />
              </div>
              <h3 className="text-lg font-semibold text-slate-200 mb-2">Start a Conversation</h3>
              <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
                Ask questions about your documents. Get AI-powered answers based on your PDFs.
              </p>
              <div className="mt-6 flex items-center gap-4 text-xs text-slate-500">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-green-400/50 rounded-full"></div>
                  <span>Ask anything</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Search className="w-3 h-3" />
                  <span>Document search</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {tab === "chat" && (
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your documents…"
              disabled={insightsLoading}
              className="flex-1 bg-white/5 outline-none text-sm text-slate-100 placeholder:text-slate-400 px-3 py-2 rounded-xl border border-white/20 focus:ring-2 focus:ring-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || insightsLoading}
              className={cls(
                "px-3 py-2 rounded-xl flex items-center gap-2 text-sm transition-colors",
                input.trim() && !insightsLoading
                  ? "bg-neutral-800 hover:bg-neutral-700 text-slate-100"
                  : "bg-neutral-900 text-slate-500 cursor-not-allowed"
              )}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
