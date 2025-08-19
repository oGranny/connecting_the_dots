import React, { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { cls } from "../../lib/utils";
import TopTabs from "./components/TopTabs";
import PodcastPanel from "./components/PodcastPanel";
import { InsightsCard, InsightsLoading } from "./components/Insights";
import { ragQuery, bucketize } from "./lib/helpers";
import "./rightpanel.css";
import { MessageCircle, Search, Zap } from "lucide-react"; // Add these imports

export default function ChatPanel({ activeFile, onFileSelect, files }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your doc AI. Select text in the PDF to see overlapping, contradictory, examples, and more." },
  ]);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState("insights");
  const [lastSelection, setLastSelection] = useState("");
  const [podcastWorking, setPodcastWorking] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const viewRef = useRef(null);

  // auto-scroll on new messages or tab switch
  useEffect(() => {
    if (tab === "podcast") return; 
    const el = viewRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, [messages, tab]);

  // viewer selections -> "doc-anchor"
  useEffect(() => {
    async function handleAnchor(e) {
      const { text } = e.detail || {};
      const sel = (text || "").trim();
      if (!sel) return;

      setLastSelection(sel);
      setInsightsLoading(true);

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

  // free-typed questions
  const send = useCallback(async (text) => {
    const t = text.trim();
    if (!t) return;
    setMessages((m) => [...m, { role: "user", content: t }]);
    setInput("");
    setInsightsLoading(true);
    
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
    } finally {
      setInsightsLoading(false);
    }
  }, []);

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
        <div hidden={tab !== "podcast"}>
          <PodcastPanel
            activeFile={activeFile}
            lastSelection={lastSelection}
            onWorkingChange={setPodcastWorking}
          />
        </div>
       
        <div hidden={tab !== "insights"}>
          {insightsLoading && <InsightsLoading />}
          {visible.length ? (
            visible.map((m, i) => (
              <InsightsCard
                key={`ins-${i}`}
                selection={m.selection}
                answer={m.answer}
                buckets={m.buckets}
                activeFile={activeFile}
                onFileSelect={onFileSelect}
                files={files}
              />
            ))
          ) : (
            !insightsLoading && (
              <div className="flex flex-col items-center justify-center text-center py-3 px-4">
                {/* Search Icon styled like podcast tab */}
                <div className="rounded-2xl p-5 bg-white/5 border border-white/20 mb-4">
                  <Search size={64} className="text-slate-300" />
                </div>

                {/* Title */}
                <h3 className="text-lg font-semibold text-slate-200 mb-2">
                  Discover Insights
                </h3>

                {/* Description */}
                <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
                  Select any text in your PDF to instantly find related content, 
                  contradictions, and examples across all your documents.
                </p>

                {/* Action hints */}
                <div className="mt-6 flex items-center gap-4 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 bg-blue-400/50 rounded-full"></div>
                    <span>Select text</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MessageCircle className="w-3 h-3" />
                    <span>Ask questions</span>
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        <div hidden={tab !== "chat"}>
          {visible.map((m, i) => (
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
          ))}
        </div>
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
