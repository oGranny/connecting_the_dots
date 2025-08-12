import React, { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { cls } from "../lib/utils";

export default function ChatPanel({ activeFile }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your doc AI. Ask me to summarize, find terms, or extract a table." },
  ]);
  const [input, setInput] = useState("");
  const viewRef = useRef(null);

  // drag state
  const dragRef = useRef({ active: false, x: 0, y: 0, sl: 0, st: 0 });

  function onMouseDown(e) {
    if (e.button !== 0) return; // left button only
    const el = viewRef.current;
    if (!el) return;

    const tag = e.target?.tagName?.toLowerCase();
    if (["input", "textarea", "button"].includes(tag)) return;

    dragRef.current = {
      active: true,
      x: e.clientX,
      y: e.clientY,
      sl: el.scrollLeft,
      st: el.scrollTop,
    };

    el.classList.add("cursor-grabbing", "select-none");
    el.classList.remove("cursor-grab");
  }

  function onMouseMove(e) {
    const el = viewRef.current;
    const s = dragRef.current;
    if (!el || !s.active) return;

    // if button released mid-move
    if ((e.buttons & 1) === 0) return endDrag();

    e.preventDefault(); // prevent text selection while dragging
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    el.scrollLeft = s.sl - dx;
    el.scrollTop = s.st - dy;
  }

  function endDrag() {
    const el = viewRef.current;
    dragRef.current.active = false;
    if (!el) return;
    el.classList.add("cursor-grab");
    el.classList.remove("cursor-grabbing", "select-none");
  }

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      // jsdom fallback
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function fakeAnswer(kind) {
    const fileName = activeFile?.name || "the current document";
    const replies = {
      summarize: `Here’s a crisp summary of ${fileName}: It introduces the Agile Tester Foundation extension, outlines entry requirements, and suggests a minimum teaching duration.`,
      outline: "Outline: 2.1 Intended Audience, 2.2 Career Paths, 2.3 Learning Objectives, 2.4 Entry Requirements, 2.5 Structure & Duration.",
      glossary: "Key terms: Agile Tester, Foundation Level, Syllabus, Learning Objectives, Entry Requirements.",
      generic: `I'll analyze ${fileName} and get back with details.`,
    };
    return replies[kind] || replies.generic;
  }

  function send(text) {
    const t = text.trim();
    if (!t) return;
    setMessages((m) => [...m, { role: "user", content: t }]);
    setTimeout(() => {
      setMessages((m) => [...m, { role: "assistant", content: fakeAnswer("generic") }]);
    }, 400);
    setInput("");
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* header */}
      <div className="flex items-center gap-2 p-3 border-b border-slate-700/60">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <div className="text-sm font-medium text-white">AI Assistant</div>
        <div className="ml-auto text-[10px] text-slate-400">Context aware of the open PDF</div>
      </div>

      {/* chat area */}
      <div
        ref={viewRef}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 cursor-grab no-scrollbar"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={cls(
              "max-w-[92%] rounded-2xl px-3 py-2 text-sm",
              m.role === "assistant" ? "bg-slate-700/60 text-slate-100" : "bg-indigo-600 text-white ml-auto"
            )}
          >
            {m.content}
          </div>
        ))}

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            onClick={() => setMessages((m) => [...m, { role: "assistant", content: fakeAnswer("summarize") }])}
            className="text-xs px-2 py-1.5 rounded-md bg-slate-800/70 text-slate-200 border border-slate-700 hover:bg-slate-700"
          >
            Summarize current doc
          </button>
          <button
            onClick={() => setMessages((m) => [...m, { role: "assistant", content: fakeAnswer("outline") }])}
            className="text-xs px-2 py-1.5 rounded-md bg-slate-800/70 text-slate-200 border border-slate-700 hover:bg-slate-700"
          >
            Extract outline
          </button>
          <button
            onClick={() => setMessages((m) => [...m, { role: "assistant", content: fakeAnswer("glossary") }])}
            className="text-xs px-2 py-1.5 rounded-md bg-slate-800/70 text-slate-200 border border-slate-700 hover:bg-slate-700"
          >
            Build glossary
          </button>
          <button
            onClick={() => setMessages((m) => [...m, { role: "assistant", content: "Ask me about any section." }])}
            className="text-xs px-2 py-1.5 rounded-md bg-slate-800/70 text-slate-200 border border-slate-700 hover:bg-slate-700"
          >
            What can you do?
          </button>
        </div>
      </div>

      {/* footer */}
      <div className="p-3 border-t border-slate-700/60">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder="Ask about the document…"
            className="flex-1 bg-slate-800/70 outline-none text-sm text-slate-100 placeholder:text-slate-400 px-3 py-2 rounded-lg border border-slate-700 focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={() => send(input)}
            className="px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 flex items-center gap-2 text-sm"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
