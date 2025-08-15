import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { uuid, sleep } from "./lib/utils";
import useDragResize from "./hooks/useDragResize";
import CenterViewer from "./components/viewer/CenterViewer";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import ChatPanel from "./components/ChatPanel";
import { API_BASE, uploadToBackend as uploadFile, detectHeadings as detect } from "./services/api";
import StatusBar from "./components/StatusBar";

/* =========================
  Config now in services/api.js (API_BASE)
========================= */

export default function App() {
  const left = useDragResize({ initial: 260, min: 200, max: 420 });
  const right = useDragResize({ initial: 260, min: 280, max: 560, invert: true });

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
        setHeadingsByFile((prev) => ({ ...prev, [localFile.id]: hs }));
      }
      setAnalyzing((m) => ({ ...m, [localFile.id]: status }));
    };

    try {
      const res = await detect(localFile.serverId);
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
      {/* <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800/80 bg-black/70">
        <div className="mx-auto text-sm font-medium">Document Workspace</div>
      </div> */}

      {/* main body (subtract TOP: 3rem and BOTTOM: 2rem) */}
      <div className="h-[calc(100%-3rem-2rem)] w-full flex grow overflow-hidden">
        {/* left sidebar */}
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

        {/* left handle */}
        <div onMouseDown={left.startDrag} title="Drag to resize" className="w-2 border-r-[1px] border-zinc-800 cursor-col-resize grid place-items-center">
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
            onReady={(api) => {
              viewerApiRef.current = api || {};
            }}
            onStatus={setViewerStatus} // lets StatusBar show current page/fit
          />
        </div>

        {/* right handle */}
        <div onMouseDown={right.startDrag} title="Drag to resize" className="w-2 border-l-[1px] border-zinc-800 cursor-col-resize grid place-items-center">
          <div className="w-1 h-10 rounded bg-slate-700" />
        </div>

        {/* right chat */}
        <div style={{ width: right.width }} className="h-full min-h-0 border-l border-slate-800 bg-slate-900/60 flex flex-col">
          <ChatPanel activeFile={activeFile} />
        </div>
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
