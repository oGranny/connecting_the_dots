import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { uuid, sleep, cls } from "./lib/utils";
import { niceName } from "./components/rightpanel/lib/helpers";
import useDragResize from "./hooks/useDragResize";
import CenterViewer from "./components/viewer/CenterViewer";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import ChatPanel from "./components/rightpanel";
import StatusBar from "./components/StatusBar";
import { API_BASE, uploadToBackend as uploadFile, detectHeadings as detect, deleteFromBackend } from "./services/api";

import "./components/viewer/scrollbar.css";
import "./components/viewer/selection.css";

export default function App() {
  const left = useDragResize({ initial: 260, min: 200, max: 420 });
  const right = useDragResize({ initial: 300, min: 280, max: 560, invert: true });

  const [resizing, setResizing] = useState(false);
  
  // Initialize files from localStorage
  const [files, setFiles] = useState(() => {
    try {
      const saved = localStorage.getItem('app_files');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  
  // Initialize activeId - will be set after files are loaded
  const [activeId, setActiveId] = useState(null);

  // Add global zoom state
  const [globalZoom, setGlobalZoom] = useState(() => {
    // Optionally restore zoom from localStorage
    const saved = localStorage.getItem("pdf-zoom");
    return saved ? parseFloat(saved) : 1;
  });

  // Save zoom to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("pdf-zoom", globalZoom.toString());
  }, [globalZoom]);

  const [headingsByFile, setHeadingsByFile] = useState(() => {
    try {
      const saved = localStorage.getItem('app_headingsByFile');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  
  const [analyzing, setAnalyzing] = useState(() => {
    try {
      const saved = localStorage.getItem('app_analyzing');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Restore activeId after files are loaded (only on initial mount)
  useEffect(() => {
    if (files.length === 0) return;
    
    try {
      const savedActiveId = localStorage.getItem('app_activeId');
      if (savedActiveId && files.some(f => f.id === savedActiveId)) {
        // Saved activeId exists and matches a file
        setActiveId(savedActiveId);
      } else {
        // No saved activeId or it doesn't match any file, use first file
        setActiveId(files[0].id);
      }
    } catch {
      // Fallback to first file
      setActiveId(files[0].id);
    }
  }, []); // Run only once on mount

  // Handle case when files change but we need to maintain or update activeId
  useEffect(() => {
    if (files.length === 0) {
      setActiveId(null);
      return;
    }

    // If no active file or current active file doesn't exist, select first file
    if (!activeId || !files.some(f => f.id === activeId)) {
      setActiveId(files[0].id);
    }
  }, [files.length]); // Only when number of files changes

  // viewer API to jump when clicking headings
  const viewerApiRef = useRef({ gotoPage: () => {}, search: () => {} });

  // status bar state
  const [backend, setBackend] = useState({ online: false, pingMs: null });
  const [viewerStatus, setViewerStatus] = useState({});   // { page, fit? }

  /* ---------- Backend health ping (TOP-LEVEL EFFECT) ---------- */

  // end resizing on global mouse/touch release
  useEffect(() => {
    const end = () => setResizing(false);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchend", end);
    };
  }, []);

  const startLeftResize = (e) => {
    e.preventDefault();
    setResizing(true);
    left.startDrag(e);
  };
  const startRightResize = (e) => {
    e.preventDefault();
    setResizing(true);
    right.startDrag(e);
  };

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
  const uploadToBackendStable = useCallback(async (file) => uploadFile(file), []);

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
            const meta = await uploadToBackendStable(f);
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
    [uploadToBackendStable, detectHeadingsForFile, activeId]
  );

  // Save to localStorage whenever state changes
  useEffect(() => {
    localStorage.setItem('app_files', JSON.stringify(files));
  }, [files]);

  useEffect(() => {
    if (activeId) {
      localStorage.setItem('app_activeId', activeId);
    } else {
      localStorage.removeItem('app_activeId');
    }
  }, [activeId]);

  useEffect(() => {
    localStorage.setItem('app_headingsByFile', JSON.stringify(headingsByFile));
  }, [headingsByFile]);

  useEffect(() => {
    localStorage.setItem('app_analyzing', JSON.stringify(analyzing));
  }, [analyzing]);

  // Clean up localStorage when a tab is closed
  const closeTab = useCallback(async (id) => {
    const fileToClose = files.find(f => f.id === id);
    
    // Show loading state if desired
    if (fileToClose?.serverId) {
      setAnalyzing(prev => ({ ...prev, [id]: "deleting" }));
    }
    
    // Clean up backend file if it exists
    if (fileToClose?.serverId) {
      const result = await deleteFromBackend(fileToClose.serverId);
      if (result?.removed_chunks > 0) {
        console.log(`Removed ${result.removed_chunks} chunks from RAG index`);
      }
    }
    
    // Clean up object URL if it was created locally
    if (fileToClose?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(fileToClose.url);
    }
    
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (id === activeId) {
        setActiveId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
    
    // Clean up associated data
    setHeadingsByFile((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    
    setAnalyzing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [files, activeId]);

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

  // Handle PDF switching and navigation
  useEffect(() => {
    function handleSwitchAndGoto(e) {
      const { fileName, page } = e.detail || {};
      if (!fileName || !page) return;

      // Find the file that matches this filename
      const targetFile = files.find(f => {
        // Try multiple matching strategies
        if (f.name === fileName) return true;
        if (fileName.endsWith(f.name)) return true;
        if (f.name.endsWith(fileName)) return true;
        
        // Try with niceName
        const nice1 = niceName(fileName);
        const nice2 = niceName(f.name);
        if (nice1 === nice2) return true;
        if (nice1 === f.name) return true;
        if (nice2 === fileName) return true;
        
        return false;
      });

      if (targetFile) {
        console.log(`Switching to file: ${targetFile.name}, page: ${page}`);
        
        // Switch to the target file
        setActiveId(targetFile.id);
        
        // Wait a bit for the viewer to load, then jump to page
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("viewer:goto", { 
              detail: { page, docId: targetFile.id } 
            })
          );
        }, 300); // Increased timeout for better reliability
      } else {
        console.warn(`Could not find PDF file: ${fileName}`, 'Available files:', files.map(f => f.name));
      }
    }

    window.addEventListener("switch-and-goto", handleSwitchAndGoto);
    return () => window.removeEventListener("switch-and-goto", handleSwitchAndGoto);
  }, [files]);

  return (
    <div
      className={`fixed inset-0 w-full h-full flex flex-col overflow-hidden bg-black text-slate-100 ${resizing ? "select-none" : ""}`}
      onSelectStart={resizing ? (e) => e.preventDefault() : undefined}
    >
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
              files={files}
              activeFileId={activeId}
              onFileSelect={(arg) => {console.log('File select triggered, activeId:', arg); setActiveId(arg)}}
            />
          </div>
        </div>

        {/* left handle */}
        <div onMouseDown={startLeftResize} onTouchStart={startLeftResize} title="Drag to resize" className="w-2 border-r-[1px] border-zinc-800 cursor-col-resize grid place-items-center">
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
            zoom={globalZoom}        // Pass zoom as prop
            setZoom={setGlobalZoom}  // Pass setZoom as prop
            onReady={(api) => {
              viewerApiRef.current = api || {};
            }}
            onStatus={setViewerStatus} // lets StatusBar show current page/fit
          />
        </div>

        {/* right handle */}
        <div onMouseDown={startRightResize} onTouchStart={startRightResize} title="Drag to resize" className="w-2 border-l-[1px] border-zinc-800 cursor-col-resize grid place-items-center">
          <div className="w-1 h-10 rounded bg-slate-700" />
        </div>

        {/* right chat */}
        <div style={{ width: right.width }} className="h-full min-h-0 border-l border-slate-800 bg-slate-900/60 flex flex-col">
          <ChatPanel activeFile={activeFile} onFileSelect={setActiveId} files={files} />
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
