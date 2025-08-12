import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { uuid, sleep } from "./lib/utils";
import useDragResize from "./hooks/useDragResize";
import CenterViewer from "./components/CenterViewer";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import ChatPanel from "./components/ChatPanel";
import { API_BASE, uploadToBackend as uploadFile, detectHeadings as detect } from "./services/api";

/* =========================
  Config now in services/api.js (API_BASE)
========================= */


/* -------------------- Main -------------------- */
export default function App() {
  const left = useDragResize({ initial: 260, min: 200, max: 420 });
  const right = useDragResize({ initial: 260, min: 280, max: 560, invert: true });

  const [files, setFiles] = useState([]); // {id, name, url, file, serverId, size}
  const [activeId, setActiveId] = useState(null);

  // headings per LOCAL file id: { [fileId]: Array<{id, level, title, page, hidden?}> }
  const [headingsByFile, setHeadingsByFile] = useState({});
  // analysis status per LOCAL file id: 'pending' | 'done' | 'error'
  const [analyzing, setAnalyzing] = useState({});

  // hold viewer API to jump when clicking headings
  const viewerApiRef = useRef({ gotoPage: () => {}, search: () => {} });

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
        <div style={{ width: right.width }} className="h-full min-h-0 border-l border-slate-800 bg-slate-900/60 flex flex-col">
          <ChatPanel activeFile={activeFile} />
        </div>
      </div>
    </div>
  );
}
