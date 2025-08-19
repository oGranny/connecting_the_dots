import React, { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { cls } from "../../lib/utils";
import TopTabs from "./components/TopTabs";
import PodcastPanel from "./components/PodcastPanel";
import { InsightsCard, InsightsLoading } from "./components/Insights";
import { ragQuery, bucketize } from "./lib/helpers";
import "./rightpanel.css";
import { MessageCircle, Search, Bot, User } from "lucide-react";

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
  const inputRef = useRef(null);

  // auto-scroll on new messages or tab switch
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

  // viewer selections -> "doc-anchor"
  useEffect(() => {
    async function handleAnchor(e) {
      const { text } = e.detail || {};
      const sel = (text || "").trim();
      if (!sel) return;

      setLastSelection(sel);
      
      // Clear old insights immediately when new selection is made
      setMessages((m) => m.filter(msg => msg.role !== "assistant_insights"));
      
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

  // Simple send function for both insights and chat
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || insightsLoading) return;

    // Add user message
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setInsightsLoading(true);

    try {
      // Both tabs now use RAG query
      const res = await ragQuery(text, 10);
      
      if (tab === "chat") {
        // For chat tab, show simple answer
        setMessages((prev) => [
          ...prev, 
          { role: "assistant", content: res.answer || "I couldn't find relevant information in the documents." }
        ]);
      } else {
        // For insights tab, show full insights with buckets
        const buckets = bucketize(text, res.contexts || []);
        setMessages((prev) => [
          ...prev,
          { role: "assistant_insights", selection: text, answer: res.answer, buckets },
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
  }, [input, tab, insightsLoading]);

  // Simple input handlers
  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === " " || e.code === "Space" || e.key === "Spacebar") {
      e.stopPropagation();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

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
          {/* Loading state for chat */}
          {insightsLoading && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-4 h-4 text-blue-400" />
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-md px-4 py-3 max-w-[85%]">
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span>Searching documents...</span>
                </div>
              </div>
            </div>
          )}

          {visible.length ? (
            <div className="space-y-4">
              {visible.map((m, i) => (
                <div
                  key={`chat-${i}`}
                  className={cls(
                    "flex gap-3",
                    m.role === "assistant" ? "items-start" : "items-start flex-row-reverse"
                  )}
                >
                  {/* Avatar */}
                  <div className={cls(
                    "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1",
                    m.role === "assistant" 
                      ? "bg-blue-500/20 text-blue-400" 
                      : "bg-green-500/20 text-green-400"
                  )}>
                    {m.role === "assistant" ? (
                      <Bot className="w-4 h-4" />
                    ) : (
                      <User className="w-4 h-4" />
                    )}
                  </div>

                  {/* Message bubble */}
                  <div className={cls(
                    "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    m.role === "assistant"
                      ? "bg-white/5 text-slate-100 border border-white/10 rounded-tl-md"
                      : "bg-blue-600/20 text-slate-100 border border-blue-500/20 rounded-tr-md"
                  )}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-8 px-4">
              <div className="rounded-2xl p-5 bg-white/5 border border-white/20 mb-4">
                <MessageCircle size={64} className="text-slate-300" />
              </div>
              <h3 className="text-lg font-semibold text-slate-200 mb-2">
                Start a Conversation
              </h3>
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
