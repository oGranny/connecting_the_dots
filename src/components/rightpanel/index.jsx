import React, { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { cls } from "../../lib/utils";
import TopTabs from "./components/TopTabs";
import PodcastPanel from "./components/PodcastPanel";
import { InsightsCard, InsightsLoading } from "./components/Insights";
import { ragQuery, bucketize } from "./lib/helpers";
import "./rightpanel.css";

export default function ChatPanel({ activeFile, onFileSelect, files }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your doc AI. Select text in the PDF to see overlapping, contradictory, examples, and more." },
  ]);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState("insights");
  const [lastSelection, setLastSelection] = useState("");
  const [podcastWorking, setPodcastWorking] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false); // Add loading state

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
      setInsightsLoading(true); // Start loading

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
        setInsightsLoading(false); // Stop loading
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
    setInsightsLoading(true); // Start loading
    
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
      setInsightsLoading(false); // Stop loading
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
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 themed-scrollbar"
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${tab}-tab`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
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
              <div className="text-xs text-slate-400 px-2">
                No insights yet. Select text in the PDF or ask a question from the Chat tab.
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
