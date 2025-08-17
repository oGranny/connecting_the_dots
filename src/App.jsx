import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { uuid, sleep } from "./lib/utils";
import useDragResize from "./hooks/useDragResize";
import CenterViewer from "./components/viewer/CenterViewer";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import ChatPanel from "./components/ChatPanel";
import { API_BASE, uploadToBackend as uploadFile, detectHeadings as detect } from "./services/api";
import StatusBar from "./components/StatusBar";
import "./components/viewer/scrollbar.css";
import "./components/viewer/selection.css";


/* =========================
  Config now in services/api.js (API_BASE)
========================= */

export default function App() {
  const left = useDragResize({ initial: 260, min: 200, max: 420 });
  const right = useDragResize({ initial: 260, min: 280, max: 560, invert: true });

  const [leftVisible, setLeftVisible] = useState(true);
  const [rightVisible, setRightVisible] = useState(true);


  // Optional: start with side panes hidden on small screens
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) {
      setLeftVisible(false);
      setRightVisible(false);
    }
  }, []);

  const [files, setFiles] = useState([]);                 // {id, name, url, file, serverId, size}
  const [activeId, setActiveId] = useState(null);

  // headings per LOCAL file id: { [fileId]: Array<{id, level, title, page, hidden?}> }
  const [headingsByFile, setHeadingsByFile] = useState({});
  // analysis status per LOCAL file id: 'pending' | 'done' | 'error'
  const [analyzing, setAnalyzing] = useState({});

  // viewer API to jump when clicking headings
  const viewerApiRef = useRef({ gotoPage: () => {}, search: () => {} });

  // status bar state
  const [backend, setBackend] = useState({ online: false, pingMs: null });
  const [viewerStatus, setViewerStatus] = useState({});   // { page, fit? }

  /* ---------- Helpers ---------- */

  // If backend returns all H1, try to infer depth from dotted numbering like "1", "1.2", "2.3.4", etc.
  function inferLevelFromNumbering(title) {
    const s = `${title || ""}`.trim();
    // Match: 1 , 1.2 , 1.2.3 , optionally followed by ), -, space, etc.
    const m = s.match(/^(\d+(?:\.\d+){0,5})[)\s\-–—\]]/);
    if (!m) return null;
    const segs = m[1].split(".").length;
    return Math.min(segs, 4); // 1 -> H1, 1.1 -> H2, 1.1.1 -> H3, 1.1.1.1 -> H4
  }

  function applyNumberingLevels(headings) {
    return (headings || []).map((h) => {
      const n = inferLevelFromNumbering(h.title);
      const base = n != null ? n : Number(h.level) || 1;
      const lvl = Math.max(1, Math.min(4, base));
      return { ...h, level: lvl };
    });
  }

  // Force a sane H1→H2→H3→H4 progression on the client even if the backend is noisy.
  // - Clamp to 1..4
  // - Disallow jumps > +1 depth at a time (e.g., H1 -> H3 becomes H2)
  function enforceHierarchy(headings) {
    if (!Array.isArray(headings) || headings.length === 0) return [];
    let prev = 1;
    return headings.map((h, i) => {
      let lvl = Number(h.level) || 1;
      lvl = Math.max(1, Math.min(4, lvl)); // clamp 1..4

      if (i === 0) {
        // first item can be whatever (clamped), but don't start below H1
        prev = lvl;
      } else {
        if (lvl > prev + 1) lvl = prev + 1; // prevent skipping levels
        // allow going shallower any amount (e.g., H3 -> H1) – common in outlines
        lvl = Math.max(1, Math.min(4, lvl));
        prev = lvl;
      }

      return { ...h, level: lvl };
    });
  }

  /* ---------- Backend health ping (TOP-LEVEL EFFECT) ---------- */
  useEffect(() => {
    let mounted = true;
    const url = `${(API_BASE || "").replace(/\/+$/, "")}/api/health`;

    const ping = async () => {
      const t0 = performance.now();
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!mounted) return;
        setBackend({
          online: res.ok,
          pingMs: res.ok ? Math.round(performance.now() - t0) : null,
        });
      } catch {
        if (!mounted) return;
        setBackend({ online: false, pingMs: null });
      }
    };

    ping();
    const onFocus = () => ping();
    const id = setInterval(ping, 30000);
    window.addEventListener("focus", onFocus);
    return () => {
      mounted = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  /* ---------- Backend calls (stable) ---------- */
  const uploadToBackend = useCallback(async (file) => uploadFile(file), []);

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
        // If backend sent all H1, try to infer levels from numeric prefixes like "1.2.3"
        let base = hs;
        if (Array.isArray(hs) && hs.length > 0 && hs.every((x) => Number(x.level) === 1)) {
          base = applyNumberingLevels(hs);
        } else {
          // Even if not all are H1, normalize any numeric prefixes we can detect
          base = applyNumberingLevels(hs);
        }
        // Then enforce sane H1→H2→H3→H4 progression (no big jumps)
        const shaped = enforceHierarchy(base);
        setHeadingsByFile((prev) => ({ ...prev, [localFile.id]: shaped }));
      }
      setAnalyzing((m) => ({ ...m, [localFile.id]: status }));
    };

    try {
      // Ask backend for the fast heuristic by default; you can change to "yolo" to force YOLO
      const res = await detect(localFile.serverId, "auto"); // try YOLO first, fallback to heuristic
      if (res.ok) return finishWith("done", res.data);
      return finishWith("error");
    } catch (e) {
      return finishWith("error");
    }
  }, []);

  // compute visible headings count for status bar
  const visibleHeadingsCount = (headingsByFile[activeId] || []).filter((h) => !h.hidden).length;

  const addFiles = useCallback(
    async (fileList) => {
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
    },
    [uploadToBackend, detectHeadingsForFile, activeId]
  );

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

  // drag & drop on center
  const dropRef = useRef(null);
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
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
  const handleFilter = useCallback(
    (q) => {
      const query = (q || "").toLowerCase();
      setHeadingsByFile((prev) => {
        const arr = prev[activeId] || [];
        return {
          ...prev,
          [activeId]: arr.map((h) => ({
            ...h,
            hidden: query && !`${h.title}`.toLowerCase().includes(query),
          })),
        };
      });
    },
    [activeId]
  );

  return (
    <div className="fixed inset-0 w-full h-full flex flex-col overflow-hidden bg-black text-slate-100">
      {/* top bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 bg-black/70">
        <div className="text-sm truncate max-w-[70%] sm:max-w-[60%] text-white/80">
          {activeFile?.name || "No document"}
        </div>
      </div>

      {/* main body (subtract TOP: 3rem and BOTTOM: 2rem) */}
      <div className="h-[calc(100%-3rem-2rem)] w-full flex grow overflow-hidden relative">
        {/* overlay restore buttons when panes are hidden */}
        {!leftVisible && (
          <button
            type="button"
            aria-label="Show left pane"
            title="Show left pane"
            onClick={() => setLeftVisible(true)}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-40 w-8 h-8 grid place-items-center rounded-full border border-white/20 bg-black/60 hover:bg-white/10 text-white/90"
          >
            &gt;
          </button>
        )}
        {!rightVisible && (
          <button
            type="button"
            aria-label="Show right pane"
            title="Show right pane"
            onClick={() => setRightVisible(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-40 w-8 h-8 grid place-items-center rounded-full border border-white/20 bg-black/60 hover:bg-white/10 text-white/90"
          >
            &lt;
          </button>
        )}
        {/* left sidebar */}
        {leftVisible && (
          <div style={{ width: left.width }} className="h-full border-r border-neutral-800 bg-black/60 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
              <Sidebar
                headings={activeHeadings.filter((h) => !h.hidden)}
                status={activeStatus}
                onJumpToHeading={(page) => viewerApiRef.current?.gotoPage?.(page)}
                onFilter={handleFilter}
              />
            </div>
          </div>
        )}

        {/* left handle */}
        {leftVisible && (
          <div onMouseDown={left.startDrag} title="Drag to resize" className="w-2 border-r-[1px] border-zinc-800 cursor-col-resize grid place-items-center">
            <div className="w-1 h-10 rounded bg-slate-700" />
          </div>
        )}
        {leftVisible && (
          <button
            type="button"
            aria-label="Hide left pane"
            title="Hide left pane"
            onClick={() => setLeftVisible(false)}
            className="w-4 h-full flex items-center justify-center text-white/60 hover:text-white/90 hover:bg-white/5 select-none"
          >
            &lt;
          </button>
        )}

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
            onReady={(api) => {
              viewerApiRef.current = api || {};
            }}
            onStatus={setViewerStatus} // lets StatusBar show current page/fit
          />
        </div>

        {rightVisible && (
          <button
            type="button"
            aria-label="Hide right pane"
            title="Hide right pane"
            onClick={() => setRightVisible(false)}
            className="w-4 h-full flex items-center justify-center text-white/60 hover:text-white/90 hover:bg-white/5 select-none"
          >
            &gt;
          </button>
        )}
        {/* right handle */}
        {rightVisible && (
          <div onMouseDown={right.startDrag} title="Drag to resize" className="w-2 border-l-[1px] border-zinc-800 cursor-col-resize grid place-items-center">
            <div className="w-1 h-10 rounded bg-slate-700" />
          </div>
        )}

        {/* right chat */}
        {rightVisible && (
          <div style={{ width: right.width }} className="h-full min-h-0 border-l border-slate-800 bg-slate-900/60 flex flex-col">
            <ChatPanel activeFile={activeFile} />
          </div>
        )}
      </div>

      {/* bottom status bar */}
      <StatusBar
        activeFile={activeFile}
        headingsCount={visibleHeadingsCount}
        analyzingStatus={activeStatus}
        backend={backend}
        viewerStatus={viewerStatus}
        tone="slate"   // try: "violet" | "emerald" | "rose" | "slate"
      />
    </div>
  );
}