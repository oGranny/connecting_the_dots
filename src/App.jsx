import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ChevronDown, ChevronRight, FileText, Plus, Search, Send, Upload, X, Loader2 } from "lucide-react";

/* =========================
   Config
   - If you set REACT_APP_API_BASE=http://localhost:4000, requests bypass CRA proxy.
   - If left empty (""), CRA proxy (package.json "proxy") will be used in dev.
========================= */
const API_BASE = process.env.REACT_APP_API_BASE || "";

/* -------------------- utils -------------------- */
const cls = (...xs) => xs.filter(Boolean).join(" ");
const uuid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------- resizable hook -------------------- */
function useDragResize({ initial, min = 180, max = 560 }) {
  const [width, setWidth] = useState(initial);
  const stateRef = useRef({ dragging: false, startX: 0, startWidth: initial });

  useEffect(() => {
    function onMove(e) {
      if (!stateRef.current.dragging) return;
      const dx = e.clientX - stateRef.current.startX;
      let w = stateRef.current.startWidth + dx;
      if (w < min) w = min;
      if (w > max) w = max;
      setWidth(w);
    }
    function onUp() { stateRef.current.dragging = false; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [min, max]);

  function startDrag(e) {
    stateRef.current = { dragging: true, startX: e.clientX, startWidth: width };
  }

  return { width, startDrag };
}

/* -------------------- grab-to-pan (drag to scroll) -------------------- */
function useGrabScroll() {
  const state = useRef({ down: false, x: 0, y: 0, sl: 0, st: 0 });

  function onMouseDown(e) {
    const tag = e.target.tagName.toLowerCase();
    if (["input", "textarea", "button"].includes(tag)) return;

    const el = e.currentTarget;
    state.current = {
      down: true,
      x: e.clientX,
      y: e.clientY,
      sl: el.scrollLeft,
      st: el.scrollTop,
    };
    el.classList.add("cursor-grabbing");
    el.classList.remove("cursor-grab");
  }

  function onMouseMove(e) {
    if (!state.current.down) return;
    const el = e.currentTarget;
    el.scrollLeft = state.current.sl - (e.clientX - state.current.x);
    el.scrollTop = state.current.st - (e.clientY - state.current.y);
  }

  function end(e) {
    const el = e.currentTarget;
    state.current.down = false;
    el.classList.add("cursor-grab");
    el.classList.remove("cursor-grabbing");
  }

  return {
    onMouseDown,
    onMouseMove,
    onMouseUp: end,
    onMouseLeave: end,
    className: "cursor-grab select-none",
  };
}

/* -------------------- Adobe PDF Embed API readiness -------------------- */
function useAdobeViewSDKReady() {
  const [ready, setReady] = useState(!!window.AdobeDC);
  useEffect(() => {
    if (window.AdobeDC) { setReady(true); return; }
    const handler = () => setReady(true);
    document.addEventListener("adobe_dc_view_sdk.ready", handler);
    return () => document.removeEventListener("adobe_dc_view_sdk.ready", handler);
  }, []);
  return ready;
}

/* -------------------- Adobe Viewer (IN_LINE mode) -------------------- */
function PdfViewerAdobe({ file, onReady }) {
  const ready = useAdobeViewSDKReady();
  const containerRef = useRef(null);
  const containerId = useMemo(() => `adobe-view-${uuid()}`, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!file) { el.innerHTML = ""; return; }
    if (!ready) return;

    const clientId = process.env.REACT_APP_ADOBE_CLIENT_ID || "<YOUR_ADOBE_CLIENT_ID>";
    const adobeDCView = new window.AdobeDC.View({ clientId, divId: containerId });

    (async () => {
      try {
        let arrayBuffer;
        if (file.url) {
          const res = await fetch(file.url);
          arrayBuffer = await res.arrayBuffer();
        } else if (file.file?.arrayBuffer) {
          arrayBuffer = await file.file.arrayBuffer();
        } else {
          return;
        }

        const viewer = await adobeDCView.previewFile(
          {
            content: { promise: Promise.resolve(arrayBuffer) },
            metaData: { fileName: file.name || "document.pdf" },
          },
          {
            embedMode: "IN_LINE",
            defaultViewMode: "FIT_WIDTH",
            showDownloadPDF: true,
            showPrintPDF: true,
          }
        );

        const apis = await viewer.getAPIs();

        const gotoPage = async (pageNumber, x = 0, y = 0) => {
          try {
            if (typeof apis.gotoLocation === "function") {
              try {
                await apis.gotoLocation({ pageNumber, x, y });
              } catch {
                await apis.gotoLocation(pageNumber, x, y);
              }
            } else if (typeof apis.goToLocation === "function") {
              await apis.goToLocation({ pageNumber, x, y });
            }
          } catch (e) {
            console.warn("gotoPage failed", e);
          }
        };

        const search = async (q) => {
          try {
            if (typeof apis.search === "function") return apis.search(q);
            if (typeof apis.getSearchAPIs === "function") {
              const s = apis.getSearchAPIs();
              return s.search(q);
            }
          } catch (e) {
            console.warn("search failed", e);
          }
        };

        onReady?.({ gotoPage, search });
      } catch (e) {
        console.error("Adobe viewer failed:", e);
      }
    })();

    return () => { if (el) el.innerHTML = ""; };
  }, [ready, file, containerId, onReady]);

  return <div ref={containerRef} id={containerId} className="w-full" />;
}

/* -------------------- Sidebar -------------------- */
function Sidebar({ headings = [], status, onJumpToHeading, onFilter }) {
  const [open, setOpen] = useState({ toc: true });

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
      <div className="p-2 border border-slate-700 rounded-lg bg-slate-800/40 mb-3 flex items-center gap-2">
        <Search size={16} className="opacity-70" />
        <input
          placeholder="Filter headings…"
          className="bg-transparent outline-none text-xs flex-1 placeholder:text-slate-400"
          onChange={(e) => onFilter?.(e.target.value)}
        />
      </div>

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

        {headings?.map((h) => (
          <div
            key={h.id}
            onClick={() => onJumpToHeading?.(h.page)}
            className={cls(
              "px-2 py-1 rounded-md cursor-pointer flex items-center gap-2",
              h.level === 1 ? "bg-slate-800/60" : h.level === 2 ? "bg-slate-800/30" : "bg-slate-800/10",
              "hover:bg-slate-700/50"
            )}
            title={`Go to page ${h.page}`}
          >
            <FileText size={14} />
            <span className="text-xs truncate">H{h.level} · {h.title}</span>
            <span className="ml-auto text-[10px] text-slate-400">p.{h.page}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}

/* -------------------- Tabs -------------------- */
function Tabs({ files, activeId, onSelect, onClose, onAdd, analyzing }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-2 border-b border-slate-700/60">
      <div className="flex-1 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1">
          {files.map((f) => {
            const state = analyzing[f.id]; // 'pending' | 'done' | 'error' | undefined
            return (
              <button
                key={f.id}
                onClick={() => onSelect(f.id)}
                className={cls(
                  "group inline-flex items-center gap-2 px-3 py-1.5 rounded-t-md border border-b-0",
                  f.id === activeId
                    ? "bg-slate-700/70 text-white border-slate-600"
                    : "bg-neutral-900/60 text-slate-300 border-slate-700 hover:bg-slate-700/50 hover:text-white"
                )}
                title={f.name}
              >
                {state === "pending" ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                <span className="text-xs max-w-[160px] truncate">{f.name}</span>
                {state === "error" && <span className="text-[10px] text-red-300 ml-1">err</span>}
                <X
                  size={14}
                  className="opacity-70 ml-1 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(f.id);
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <label className="ml-auto mb-[-1px]">
        <input
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => onAdd(Array.from(e.target.files || []))}
        />
        <div className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-slate-800/70 border border-slate-700 hover:bg-slate-700 cursor-pointer">
          <Plus size={14} /> New
        </div>
      </label>
    </div>
  );
}

/* -------------------- Chat -------------------- */
function ChatPanel({ activeFile }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your doc AI. Ask me to summarize, find terms, or extract a table." },
  ]);
  const [input, setInput] = useState("");
  const viewRef = useRef(null);

  useEffect(() => {
    viewRef.current?.scrollTo({ top: viewRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function fakeAnswer(kind) {
    const fileName = activeFile?.name || "the current document";
    const replies = {
      summarize: `Here’s a crisp summary of ${fileName}: It introduces the Agile Tester Foundation extension, outlines entry requirements, and suggests a minimum teaching duration.`,
      outline: `Outline: 2.1 Intended Audience, 2.2 Career Paths, 2.3 Learning Objectives, 2.4 Entry Requirements, 2.5 Structure & Duration.`,
      glossary: `Key terms: Agile Tester, Foundation Level, Syllabus, Learning Objectives, Entry Requirements.`,
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
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 p-3 border-b border-slate-700/60">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <div className="text-sm font-medium text-white">AI Assistant</div>
        <div className="ml-auto text-[10px] text-slate-400">Context aware of the open PDF</div>
      </div>

      <div ref={viewRef} className="flex-1 scroll-area p-3 space-y-3">
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

/* -------------------- Center viewer column (vertical scroll + pan) -------------------- */
function CenterViewer({ activeFile, onReady }) {
  const grab = useGrabScroll();
  return (
    <div
      className={`flex-1 min-h-0 scroll-area overflow-x-hidden ${grab.className}`}
      onMouseDown={grab.onMouseDown}
      onMouseMove={grab.onMouseMove}
      onMouseUp={grab.onMouseUp}
      onMouseLeave={grab.onMouseLeave}
    >
      <div className="pb-12">
        {activeFile ? (
          <PdfViewerAdobe file={activeFile} onReady={onReady} />
        ) : (
          <div className="h-full w-full grid place-items-center text-center text-slate-300 py-16">
            <div>
              <div className="mx-auto w-14 h-14 grid place-items-center rounded-2xl bg-slate-800 border border-slate-700 mb-3">
                <Upload />
              </div>
              <p className="text-sm">
                Drop a PDF here or click <span className="font-medium">New</span> to upload.
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Uses Adobe PDF Embed (Inline). The center column scrolls vertically.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------- Main -------------------- */
export default function App() {
  const left = useDragResize({ initial: 260, min: 200, max: 420 });
  const right = useDragResize({ initial: 360, min: 280, max: 560 });

  const [files, setFiles] = useState([]); // {id, name, url, file, serverId, size}
  const [activeId, setActiveId] = useState(null);

  // headings per LOCAL file id: { [fileId]: Array<{id, level, title, page, hidden?}> }
  const [headingsByFile, setHeadingsByFile] = useState({});
  // analysis status per LOCAL file id: 'pending' | 'done' | 'error'
  const [analyzing, setAnalyzing] = useState({});

  // hold viewer API to jump when clicking headings
  const viewerApiRef = useRef({ gotoPage: () => {}, search: () => {} });

  /* ---------- Backend calls (stable) ---------- */
  const uploadToBackend = useCallback(async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: fd });
    if (!r.ok) throw new Error("upload failed");
    return r.json(); // { id, name, url, size, mimetype }
  }, []);

  const detectHeadingsForFile = useCallback(async (localFile) => {
    if (!localFile?.serverId) {
      setAnalyzing((m) => ({ ...m, [localFile.id]: "error" }));
      return;
    }
    setAnalyzing((m) => ({ ...m, [localFile.id]: "pending" }));
    const start = performance.now();

    const finishWith = async (status, hs = []) => {
      const elapsed = performance.now() - start;
      if (elapsed < 600) await sleep(600 - elapsed);
      if (status === "done") {
        setHeadingsByFile((prev) => ({ ...prev, [localFile.id]: hs }));
      }
      setAnalyzing((m) => ({ ...m, [localFile.id]: status }));
    };

    const mapYolo = (outline) =>
      (outline || []).map((h) => ({
        id: uuid(),
        level: h.level === "H1" ? 1 : h.level === "H2" ? 2 : 3,
        title: h.text,
        page: (h.page ?? 0) + 1, // backend 0-based -> Adobe 1-based
      }));

    const mapHeuristic = (headings) =>
      (headings || []).map((h) => ({
        id: uuid(),
        level: h.level,
        title: h.title,
        page: h.page,
      }));

    try {
      // Try YOLO first
      const r = await fetch(`${API_BASE}/api/outline-yolo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: localFile.serverId }),
      });
      const data = await r.json();

      if (r.ok && data?.outline) {
        return finishWith("done", mapYolo(data.outline));
      }

      // YOLO error → fall back to heuristic
      const r2 = await fetch(`${API_BASE}/api/headings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: localFile.serverId }),
      });
      const data2 = await r2.json();
      if (r2.ok && data2?.headings) {
        return finishWith("done", mapHeuristic(data2.headings));
      }

      return finishWith("error");
    } catch (e) {
      // network or other failure → final try heuristic
      try {
        const r3 = await fetch(`${API_BASE}/api/headings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: localFile.serverId }),
        });
        const data3 = await r3.json();
        if (r3.ok && data3?.headings) {
          return finishWith("done", mapHeuristic(data3.headings));
        }
      } catch {}
      return finishWith("error");
    }
  }, []);

  const addFiles = useCallback(async (fileList) => {
    if (!fileList?.length) return;
    const items = await Promise.all(
      fileList.map(async (f) => {
        try {
          const meta = await uploadToBackend(f);
          return {
            id: uuid(),
            name: f.name,
            url: `${API_BASE}${meta.url}`, // absolute if API_BASE set; else relative (proxy)
            file: f,
            serverId: meta.id,
            size: meta.size,
          };
        } catch {
          // fallback (no backend)
          return {
            id: uuid(),
            name: f.name,
            url: URL.createObjectURL(f),
            file: f,
            serverId: null,
            size: f.size,
          };
        }
      })
    );

    setFiles((prev) => {
      const next = [...prev, ...items];
      if (!activeId && next.length) setActiveId(next[0].id);
      return next;
    });

    // auto-run heading detection for each uploaded file
    for (const it of items) detectHeadingsForFile(it);
  }, [uploadToBackend, detectHeadingsForFile, activeId]);

  function closeTab(id) {
    setFiles((prev) => {
      const closing = prev.find((p) => p.id === id);
      if (closing && closing.url?.startsWith("blob:")) URL.revokeObjectURL(closing.url);
      const next = prev.filter((p) => p.id !== id);
      return next;
    });
    setHeadingsByFile((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    setAnalyzing((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    setActiveId((curr) => (curr === id ? null : curr));
  }

  const activeFile = useMemo(() => files.find((f) => f.id === activeId), [files, activeId]);
  const activeHeadings = headingsByFile[activeId] || [];
  const activeStatus = analyzing[activeId]; // 'pending' | 'done' | 'error' | undefined

  // If the user switches to a file that hasn't been analyzed yet, auto-run it.
  useEffect(() => {
    const active = files.find((f) => f.id === activeId);
    if (!active) return;
    if (!headingsByFile[active.id] && analyzing[active.id] !== "pending") {
      detectHeadingsForFile(active);
    }
  }, [activeId, files, headingsByFile, analyzing, detectHeadingsForFile]);

  // drag & drop on center (uses stable addFiles, fixes ESLint warning)
  const dropRef = useRef(null);
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onDrop = (e) => {
      prevent(e);
      const dropped = Array.from(e.dataTransfer.files || []).filter((f) => f.type === "application/pdf");
      addFiles(dropped);
    };
    ["dragenter", "dragover", "dragleave", "drop"].forEach((t) => el.addEventListener(t, prevent));
    el.addEventListener("drop", onDrop);
    return () => {
      ["dragenter", "dragover", "dragleave", "drop"].forEach((t) => el.removeEventListener(t, prevent));
      el.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  // filter handler for Sidebar
  const handleFilter = useCallback((q) => {
    const query = (q || "").toLowerCase();
    setHeadingsByFile((prev) => {
      const arr = prev[activeId] || [];
      return { ...prev, [activeId]: arr.map((h) => ({ ...h, hidden: query && !(`${h.title}`.toLowerCase().includes(query)) })) };
    });
  }, [activeId]);

  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden bg-black text-slate-100">
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-slate-800/80 bg-black/70 backdrop-blur">
        <div className="mx-auto text-sm font-medium">Document Workspace · Headings & Jumps</div>
      </div>

      {/* main body */}
      <div className="h-[calc(100%-3rem)] w-full flex overflow-hidden">
        {/* left sidebar */}
        <div style={{ width: left.width }} className="h-full border-r border-neutral-800 bg-black/60 flex flex-col">
          <div className="flex-1 scroll-area">
            <Sidebar
              headings={activeHeadings.filter((h) => !h.hidden)}
              status={activeStatus}
              onJumpToHeading={(page) => viewerApiRef.current?.gotoPage?.(page)}
              onFilter={handleFilter}
            />
          </div>
        </div>

        {/* left handle */}
        <div onMouseDown={left.startDrag} title="Drag to resize" className="w-2 cursor-col-resize grid place-items-center">
          <div className="w-1 h-10 rounded bg-slate-700" />
        </div>

        {/* center viewer */}
        <div ref={dropRef} className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <Tabs
            files={files}
            activeId={activeId}
            onSelect={setActiveId}
            onClose={closeTab}
            onAdd={addFiles}
            analyzing={analyzing}
          />
          <CenterViewer
            activeFile={activeFile}
            onReady={(api) => { viewerApiRef.current = api || {}; }}
          />
        </div>

        {/* right handle */}
        <div onMouseDown={right.startDrag} title="Drag to resize" className="w-2 cursor-col-resize grid place-items-center">
          <div className="w-1 h-10 rounded bg-slate-700" />
        </div>

        {/* right chat */}
        <div style={{ width: right.width }} className="h-full border-l border-slate-800 bg-slate-900/60 flex flex-col">
          <ChatPanel activeFile={activeFile} />
        </div>
      </div>
    </div>
  );
}
