import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ExternalLink,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Hand,
  Pencil,
  Highlighter,
  MousePointer2,
  ChevronLeft,
  ChevronRight,
  Rows2,
  Square,
} from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { Segment, SegButton, IconButton } from "./Toolbar";
import PDFPage from "./PDFPage";
import { clamp, thresholds } from "./utils/geometry";
import useZoomInteractions from "./hooks/useZoomInteractions";
import usePanDrag from "./hooks/usePanDrag";
import useBlockBrowserCtrlZoom from "./hooks/useBlockBrowserCtrlZoom";

// Keep worker version in lock-step with the API
const v = pdfjs.version;
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${v}/build/pdf.worker.min.mjs`;

export default function CenterViewer({ activeFile, onReady, onStatus, onAnchor }) {
  const scrollRef = useRef(null);

  // Viewer state
  const [numPages, setNumPages] = useState(null);
  const [currPage, setCurrPage] = useState(1);
  const [viewMode, setViewMode] = useState("continuous"); // "continuous" | "single"
  const [fitMode, setFitMode] = useState("width");        // "width" | "page"
  const [zoom, setZoom] = useState(1);
  const [docError, setDocError] = useState(null);

  // Geometry
  const [viewport, setViewport] = useState({ w: 0, h: 0 }); // scroll area's client size
  const [pageAspect, setPageAspect] = useState(0.75);       // width/height; updated on page load
  const dpr = Math.max(1, typeof window !== "undefined" ? window.devicePixelRatio : 1);

  // Tools
  const [tool, setTool] = useState("select"); // "select" | "hand" | "draw" | "highlight"
  const isHand = tool === "hand";
  const isDraw = tool === "draw";

  // Per-page data
  const [highlightsByPage, setHighlightsByPage] = useState({});
  const [strokesByPage, setStrokesByPage] = useState({});

  // Refs for scrolling to page
  const pageRefs = useRef({});

  // Status to parent
  useEffect(() => onStatus?.({ page: currPage, fit: fitMode, zoom, view: viewMode }), [currPage, fitMode, zoom, viewMode, onStatus]);
  useBlockBrowserCtrlZoom(scrollRef);

  // API to parent
  useEffect(() => {
    const api = {
      gotoPage: (p) => scrollToPage(clamp(parseInt(p, 10) || 1, 1, numPages || 1)),
      search: () => {},
    };
    onReady?.(api);
    return () => onReady?.(null);
  }, [numPages]);

  // useEffect(() => {
  // // disable the global, React-time blocker; your scoped hook will take over
  // window.__disableGlobalCtrlZoomBlocker?.();
  // }, []);


  // Reset on file change
  useEffect(() => {
    setCurrPage(1);
    setHighlightsByPage({});
    setStrokesByPage({});
    setZoom(1);
    setDocError(null);
  }, [activeFile?.id]);

  // Clear per-page refs whenever the active file changes to avoid observing stale nodes
  useEffect(() => {
    pageRefs.current = {};
  }, [activeFile?.id]);

  // Measure scroll viewport
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setViewport({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // When changing fit/view, reset zoom so change is obvious
  useEffect(() => setZoom(1), [fitMode, viewMode]);

  // Fit targets
  const targetBaseWidth = useMemo(() => {
    const fitWidthPx = Math.max(360, viewport.w);
    let fitPagePx = Math.floor(viewport.h * pageAspect);
    if (!Number.isFinite(fitPagePx) || fitPagePx <= 0) fitPagePx = fitWidthPx;
    fitPagePx = Math.min(fitPagePx, fitWidthPx);
    return fitMode === "page" ? fitPagePx : fitWidthPx;
  }, [viewport, pageAspect, fitMode]);

  // Final page width (apply zoom on top of fit)
  const pageWidth = Math.floor(targetBaseWidth * zoom);

  // PDF load handlers
  const onDocLoad = useCallback(({ numPages }) => setNumPages(numPages), []);
  const onFirstPageLoad = useCallback((pageProxy) => {
    const vp = pageProxy.getViewport({ scale: 1 });
    if (vp && vp.width && vp.height) setPageAspect(vp.width / vp.height);
  }, []);

  // File spec (URL or File/Blob)
  const fileSpec = useMemo(() => {
    if (!activeFile) return null;
    if (activeFile.file instanceof Blob) return activeFile.file;
    if (activeFile.url) {
      const bust = Date.now();
      return activeFile.url + (activeFile.url.includes("?") ? `&t=${bust}` : `?t=${bust}`);
    }
    return null;
  }, [activeFile]);

  // Interactions
  useZoomInteractions(scrollRef, setZoom);                         // Ctrl+wheel & touch pinch
  usePanDrag(scrollRef, { enabled: isHand, allowSpacePan: !isDraw }); // Drag-to-pan

  // Track page in view (continuous)
  useEffect(() => {
    if (viewMode !== "continuous" || !numPages) return;

    // Only keep actual Elements (filters out null/undefined)
    const all = Object.values(pageRefs.current || {});
    const els = all.filter((n) => n && n.nodeType === 1);

    if (!els.length) return;

    const rootEl = (scrollRef.current && scrollRef.current.nodeType === 1) ? scrollRef.current : null;

    const io = new IntersectionObserver(
      (entries) => {
        let best = { ratio: 0, page: currPage };
        for (const e of entries) {
          const dataPage = e.target?.dataset?.page;
          const p = Number(dataPage);
          const r = e.intersectionRatio || 0;
          if (!Number.isFinite(p)) continue;
          if (r > best.ratio) best = { ratio: r, page: p };
        }
        if (best.page && best.page !== currPage) setCurrPage(best.page);
      },
      { root: rootEl, threshold: thresholds() }
    );

    els.forEach((el) => {
      try {
        io.observe(el);
      } catch {}
    });

    return () => io.disconnect();
  }, [viewMode, numPages, pageWidth, currPage]);

  // Helpers
  const zoomIn = () => setZoom((z) => clamp(Math.round((z + 0.1) * 10) / 10, 0.25, 4));
  const zoomOut = () => setZoom((z) => clamp(Math.round((z - 0.1) * 10) / 10, 0.25, 4));
  const resetZoom = () => setZoom(1);
  const goPrev = () => {
    const p = clamp(currPage - 1, 1, numPages || 1);
    viewMode === "continuous" ? scrollToPage(p) : setCurrPage(p);
  };
  const goNext = () => {
    const p = clamp(currPage + 1, 1, numPages || 1);
    viewMode === "continuous" ? scrollToPage(p) : setCurrPage(p);
  };
  const scrollToPage = (p) => {
    const el = pageRefs.current?.[p];
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    setCurrPage(p);
  };

  // Mutators
  const addHighlightRects = (page, rects) => {
    if (!rects?.length) return;
    setHighlightsByPage((prev) => {
      const next = { ...prev };
      const arr = next[page] ? [...next[page]] : [];
      arr.push(...rects);
      next[page] = arr;
      return next;
    });
  };
  const addStroke = (page, stroke) => {
    setStrokesByPage((prev) => {
      const arr = prev[page] ? [...prev[page]] : [];
      arr.push(stroke);
      return { ...prev, [page]: arr };
    });
  };
  const undoStroke = () => {
    setStrokesByPage((prev) => {
      const arr = (prev[currPage] || []).slice(0, -1);
      return { ...prev, [currPage]: arr };
    });
  };
  const clearStrokes = () => setStrokesByPage((prev) => ({ ...prev, [currPage]: [] }));

  if (!activeFile) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-neutral-950 text-slate-300">
        <div className="text-center">
          <div className="text-sm">Drop a PDF or click <span className="font-medium">New</span>.</div>
          <div className="text-xs text-slate-400 mt-1">Ctrl+wheel & pinch zoom · continuous pages · pan/draw/highlight/anchor</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-neutral-950">
      {/* Toolbar */}
      <div className="sticky top-0 z-20 backdrop-blur bg-neutral-900/70 border-b border-white/10 shadow-[0_1px_0_0_rgba(255,255,255,0.04)]">
        <div className="h-12 px-3 flex items-center gap-3">
          {/* <div className="min-w-0 max-w-[28%] text-sm font-medium text-slate-200 truncate">
            {activeFile.name}
          </div> */}

          {/* <Segment title="View">
            <SegButton
              active={viewMode === "continuous"}
              onClick={() => setViewMode("continuous")}
              icon={<Rows2 size={16} />}
              label="Continuous"
            />
            <SegButton
              active={viewMode === "single"}
              onClick={() => setViewMode("single")}
              icon={<Square size={16} />}
              label="Single"
            />
          </Segment> */}

          <Segment title="Tools">
            {/* <SegButton active={tool === "select"} onClick={() => setTool("select")} icon={<MousePointer2 size={16} />} label="Select" /> */}
            {/* <SegButton active={tool === "hand"} onClick={() => setTool(tool === "hand" ? "select" : "hand")} icon={<Hand size={16} />} label="Hand" hint="Space" /> */}
            <SegButton active={tool === "draw"} onClick={() => setTool(tool === "draw" ? "select" : "draw")} icon={<Pencil size={16} />} label="Draw" />
            {/* <SegButton active={tool === "highlight"} onClick={() => setTool(tool === "highlight" ? "select" : "highlight")} icon={<Highlighter size={16} />} label="Highlight" /> */}
          </Segment>

          <Segment title="Zoom">
            <IconButton onClick={zoomOut} title="Zoom out"><ZoomOut size={16} /></IconButton>
            <div className="px-2 min-w-[52px] text-center text-sm text-slate-200 tabular-nums">{Math.round(zoom * 100)}%</div>
            <IconButton onClick={zoomIn} title="Zoom in"><ZoomIn size={16} /></IconButton>
            <IconButton onClick={resetZoom} title="Reset zoom"><RotateCcw size={16} /></IconButton>
          </Segment>

          <div className="ml-1">
            <select
              value={fitMode}
              onChange={(e) => setFitMode(e.target.value)}
              className="h-9 rounded-xl px-3 bg-white/5 border border-white/10 text-sm text-slate-200 outline-none focus:border-white/20"
              title="Fit"
            >
              <option value="width">Fit width</option>
              <option value="page">Fit page</option>
            </select>
          </div>

          {/* <Segment title="Page">
            <IconButton onClick={goPrev} disabled={currPage <= 1} title="Previous page"><ChevronLeft size={16} /></IconButton>
            <div className="flex items-center gap-2 px-2">
              <span className="text-xs text-slate-400">Page</span>
              <input
                value={currPage}
                onChange={(e) => {
                  const p = clamp(parseInt(e.target.value || "1", 10) || 1, 1, numPages || 1);
                  viewMode === "continuous" ? scrollToPage(p) : setCurrPage(p);
                }}
                className="w-14 h-7 rounded-lg bg-black/30 border border-white/10 text-slate-200 text-sm px-2 outline-none focus:border-white/20"
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <span className="text-xs text-slate-500">/ {numPages || "-"}</span>
            </div>
            <IconButton onClick={goNext} disabled={currPage >= (numPages || 1)} title="Next page"><ChevronRight size={16} /></IconButton>
          </Segment> */}

          <div className="ml-auto flex items-center gap-2">
            {isDraw && (
              <>
                <button onClick={undoStroke} className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm" title="Undo (current page)">Undo</button>
                <button onClick={clearStrokes} className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm" title="Clear drawings (current page)">Clear</button>
              </>
            )}
            {/* <a className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm inline-flex items-center gap-2" href={activeFile.url} target="_blank" rel="noreferrer" title="Open in new tab">
              <ExternalLink size={16} /> Open
            </a> */}
            <a className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm inline-flex items-center gap-2" href={activeFile.url} download={activeFile.name || "document.pdf"} title="Download">
              <Download size={16} /> Download
            </a>
          </div>
        </div>
      </div>

      {/* Viewer */}
      <div
        ref={scrollRef}
        className={`relative flex-1 min-h-0 overflow-auto ${isHand ? "cursor-grab select-none" : isDraw ? "cursor-crosshair" : "cursor-default"} touch-none overscroll-contain`}
      >
        {fileSpec ? (
          <Document
            file={fileSpec}
            onLoadSuccess={onDocLoad}
            onLoadError={(e) => { console.error("react-pdf load error:", e); setDocError(e?.message || String(e)); }}
            onSourceError={(e) => { console.error("react-pdf source error:", e); setDocError(e?.message || String(e)); }}
            loading={<DocLoading />}
            error={<DocError text={docError || "Failed to load PDF file."} />}
            noData={<DocError text="No PDF data" />}
            className="pb-12"
          >
            {viewMode === "single" ? (
              <div className="mx-auto my-6" style={{ width: pageWidth }}>
                <PDFPage
                  scrollRef={scrollRef}
                  pageNumber={currPage}
                  pageWidth={pageWidth}
                  onFirstPageLoad={currPage === 1 ? onFirstPageLoad : undefined}
                  tool={tool}
                  dpr={dpr}
                  strokes={strokesByPage[currPage] || []}
                  onAddStroke={(s) => addStroke(currPage, s)}
                  highlights={highlightsByPage[currPage] || []}
                  onAddHighlight={(rects) => addHighlightRects(currPage, rects)}
                  onAnchor={(payload) => {
                    addHighlightRects(currPage, payload.rects);
                    try {
                      (onAnchor || (() => fetch("/api/anchor", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ docId: activeFile.id, page: currPage, text: payload.text, rects: payload.rects }),
                      })))();
                    } catch (e) { console.error("Anchor API failed:", e); }
                  }}
                />
              </div>
            ) : (
              <div className="mx-auto my-6" style={{ width: pageWidth }}>
                {Array.from({ length: numPages || 0 }, (_, i) => {
                  const p = i + 1;
                  return (
                    <div
                      key={`p-${p}`}
                      data-page={p}
                      ref={(el) => {
                        if (el) {
                          pageRefs.current[p] = el;
                        } else {
                          delete pageRefs.current[p];
                        }
                      }}
                      className="mb-6"
                    >
                      <PDFPage
                        scrollRef={scrollRef}
                        pageNumber={p}
                        pageWidth={pageWidth}
                        onFirstPageLoad={p === 1 ? onFirstPageLoad : undefined}
                        tool={tool}
                        dpr={dpr}
                        strokes={strokesByPage[p] || []}
                        onAddStroke={(s) => addStroke(p, s)}
                        highlights={highlightsByPage[p] || []}
                        onAddHighlight={(rects) => addHighlightRects(p, rects)}
                        onAnchor={(payload) => {
                          addHighlightRects(p, payload.rects);
                          try {
                            (onAnchor || (() => fetch("/api/anchor", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ docId: activeFile.id, page: p, text: payload.text, rects: payload.rects }),
                            })))();
                          } catch (e) { console.error("Anchor API failed:", e); }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Document>
        ) : (
          <DocError text="No PDF URL" />
        )}
      </div>
    </div>
  );
}

/* ---------- Loading/Error ---------- */

function DocLoading() {
  return <div className="w-full h-full grid place-items-center text-slate-400 text-xs">Loading PDF…</div>;
}
function DocError({ text = "Failed to load PDF file." }) {
  return <div className="w-full h-full grid place-items-center text-slate-400 text-sm">{text}</div>;
}
