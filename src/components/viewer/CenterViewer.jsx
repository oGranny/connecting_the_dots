import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Pencil,
  CornerUpLeft,
  Trash2,
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
import PinchZoom from "./PinchZoom";

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

  // Pinch state (for % display & resetting)
  const [pinchScale, setPinchScale] = useState(1);
  const [pzKey, setPzKey] = useState(0); // bump to reset all PinchZooms
  const [renderBoost, setRenderBoost] = useState(1);

  // Throttle render boost updates while pinching to reduce blur without heavy re-renders
  useEffect(() => {
    let t = null;
    // only boost up to 2.5x to limit work but provide better quality
    const target = Math.max(1, Math.min(2.5, pinchScale));
    // More responsive boost updates with a smaller threshold
    if (Math.abs(target - renderBoost) > 0.01) {
      t = setTimeout(() => setRenderBoost(target), 100);
    }
    return () => clearTimeout(t);
  }, [pinchScale, renderBoost]);

  // Geometry
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [pageAspect, setPageAspect] = useState(0.75);
  const dpr = Math.max(1, typeof window !== "undefined" ? window.devicePixelRatio : 1);

  // Tools
  const [tool, setTool] = useState("select"); // "select" | "hand" | "draw" | "highlight"
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

  // Reset on file change
  useEffect(() => {
    setCurrPage(1);
    setHighlightsByPage({});
    setStrokesByPage({});
    setZoom(1);
    setDocError(null);
    pageRefs.current = {}; // Clear page refs when changing documents
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

  // Final page width
  let pageWidth = Math.floor(targetBaseWidth * zoom);
  // On narrow viewports, ensure we fit inside with some padding
  const isNarrow = viewport.w && viewport.w < 640;
  if (isNarrow) {
    const pad = 32; // keep some horizontal padding for UI
    pageWidth = Math.floor(Math.max(200, Math.min(pageWidth, viewport.w - pad)));
  }

  // PDF load handlers
  const onDocLoad = useCallback(({ numPages }) => setNumPages(numPages), []);
  const onFirstPageLoad = useCallback((pageProxy) => {
    const vp = pageProxy.getViewport({ scale: 1 });
    if (vp && vp.width && vp.height) setPageAspect(vp.width / vp.height);
  }, []);

  // File spec
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
  useZoomInteractions(scrollRef, setZoom);
  usePanDrag(scrollRef, { enabled: tool === "hand", allowSpacePan: !isDraw });

  // Track page in view (continuous)
  useEffect(() => {
    if (viewMode !== "continuous" || !numPages) return;
    const els = Object.values(pageRefs.current || {}).filter(el => el && el instanceof Element);
    if (!els.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        let best = { ratio: 0, page: currPage };
        for (const e of entries) {
          const p = Number(e.target.dataset.page);
          const r = e.intersectionRatio;
          if (r > best.ratio) best = { ratio: r, page: p };
        }
        if (best.page && best.page !== currPage) setCurrPage(best.page);
      },
      { root: scrollRef.current, threshold: thresholds() }
    );
    
    els.forEach((el) => {
      if (el && el instanceof Element) {
        io.observe(el);
      }
    });
    
    return () => io.disconnect();
  }, [viewMode, numPages, pageWidth, currPage]);

  // Helpers
  const zoomLevels = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
  const nearestLevel = (z) => {
    let best = zoomLevels[0];
    let diff = Infinity;
    for (const lvl of zoomLevels) {
      const d = Math.abs(lvl - z);
      if (d < diff) { diff = d; best = lvl; }
    }
    return best;
  };
  const nextLevel = (z, dir) => {
    const idx = zoomLevels.findIndex(l => l >= z - 1e-6 && l <= z + 1e-6) !== -1 ? zoomLevels.findIndex(l => l >= z - 1e-6 && l <= z + 1e-6) : zoomLevels.indexOf(nearestLevel(z));
    if (dir > 0) return zoomLevels[Math.min(zoomLevels.length - 1, idx + 1)];
    return zoomLevels[Math.max(0, idx - 1)];
  };
  const zoomIn = () => setZoom(z => nextLevel(z, +1));
  const zoomOut = () => setZoom(z => nextLevel(z, -1));
  const resetZoom = () => setZoom(1);
  const resetZoomAndPinch = () => {
    setZoom(1);
    setPinchScale(1);
    setPzKey((k) => k + 1);
  };
  const scrollToPage = (p) => {
    const el = pageRefs.current?.[p];
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    setCurrPage(p);
  };

  // Allow ChatPanel to command page jumps in the CURRENT open PDF
  useEffect(() => {
    function onGoto(e) {
      const { page, docId } = e.detail || {};
      if (!page) return;
      if (docId && activeFile?.id && docId !== activeFile.id) return; // ignore if targeting another doc
      if (viewMode === "continuous") scrollToPage(clamp(parseInt(page, 10) || 1, 1, numPages || 1));
      else setCurrPage(clamp(parseInt(page, 10) || 1, 1, numPages || 1));
    }
    window.addEventListener("viewer:goto", onGoto);
    return () => window.removeEventListener("viewer:goto", onGoto);
  }, [viewMode, numPages, activeFile?.id]);

  // Keyboard shortcuts for zoom (Ctrl/Cmd + '+', '-', '0') and quick fit toggles
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomIn(); }
      else if (ctrl && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomOut(); }
      else if (ctrl && (e.key === '0')) { e.preventDefault(); resetZoomAndPinch(); }
      else if (e.key === 'f') { // toggle fit mode quickly
        setFitMode(f => f === 'width' ? 'page' : 'width');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  <div className="h-12 px-3 flex flex-wrap items-center gap-3">
          <Segment title="Tools">
            <SegButton
              active={tool === "draw"}
              onClick={() => setTool(tool === "draw" ? "select" : "draw")}
              icon={<Pencil size={16} />}
              label="Draw"
            />
          </Segment>

          <Segment title="Zoom">
            <IconButton onClick={zoomOut} title="Zoom out"><ZoomOut size={16} /></IconButton>
            <div className="px-2 min-w-[52px] text-center text-sm text-slate-200 tabular-nums">{Math.round(zoom * pinchScale * 100)}%</div>
            <IconButton onClick={zoomIn} title="Zoom in"><ZoomIn size={16} /></IconButton>
            <IconButton onClick={resetZoomAndPinch} title="Reset zoom"><RotateCcw size={16} /></IconButton>
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

          <div className="ml-auto flex items-center gap-2">
            {tool === "draw" && (
              <>
                <button onClick={undoStroke} className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm inline-flex items-center gap-2" title="Undo (current page)"><CornerUpLeft size={16} /><span className="hidden sm:inline">Undo</span></button>
                <button onClick={clearStrokes} className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm inline-flex items-center gap-2" title="Clear drawings (current page)"><Trash2 size={16} /><span className="hidden sm:inline">Clear</span></button>
              </>
            )}
            <a
              className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm inline-flex items-center gap-2"
              href={activeFile.url}
              download={activeFile.name || "document.pdf"}
              title="Download"
            >
              <Download size={16} /> <span className="hidden sm:inline">Download</span>
            </a>
          </div>
        </div>
      </div>

      {/* Viewer */}
      <div
        ref={scrollRef}
        className={`relative flex-1 min-h-0 overflow-auto ${
          tool === "hand" ? "cursor-grab select-none" : tool === "draw" ? "cursor-crosshair select-none" : "cursor-default"
        } touch-pan-y overscroll-contain themed-scroll`}
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
            <PinchZoom
              key={`pz-${pzKey}`}
              min={1}
              max={5}
              wheelZoom
              className="w-full flex justify-center"
              onScale={(s) => {
                setPinchScale(s);
                // lightweight quality bump while actively scaling
                const target = Math.max(1, Math.min(2, s));
                if (Math.abs(target - renderBoost) > 0.15) setRenderBoost(target);
              }}
              onScaleEnd={(s) => {
                // Commit scale into persistent zoom; reset transient state
                setZoom((z) => clamp(Math.round(z * s * 100) / 100, 0.25, 4));
                setPinchScale(1);
                setRenderBoost(1);
                // remount PinchZoom so internal transform resets cleanly
                setPzKey((k) => k + 1);
              }}
              centerZoom={false}>
              <div className="mx-auto my-6" style={{ width: pageWidth }}>
                {Array.from({ length: numPages || 0 }, (_, i) => {
                  const p = i + 1;
                  return (
                    <div key={`p-${p}`} data-page={p} ref={(el) => (pageRefs.current[p] = el || undefined)} className="mb-6 overflow-visible">
                      <PDFPage
                        scrollRef={scrollRef}
                        pageNumber={p}
                        pageWidth={pageWidth}
                        renderWidth={Math.floor(pageWidth * renderBoost)}
                        onFirstPageLoad={p === 1 ? onFirstPageLoad : undefined}
                        tool={tool}
                        dpr={dpr}
                        strokes={strokesByPage[p] || []}
                        onAddStroke={(s) => addStroke(p, s)}
                        highlights={highlightsByPage[p] || []}
                        onAddHighlight={(rects) => addHighlightRects(p, rects)}
                        onAnchor={(payload) => {
                          // 1) paint highlight locally
                          addHighlightRects(p, payload.rects);

                          // 2) notify any parent if provided
                          try {
                            (onAnchor ||
                              (() =>
                                fetch("/api/anchor", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    docId: activeFile.id,
                                    page: p,
                                    text: payload.text,
                                    rects: payload.rects,
                                  }),
                                })))();
                          } catch (e) {
                            console.error("Anchor API failed:", e);
                          }

                          // 3) broadcast to ChatPanel to trigger RAG insights
                          try {
                            window.dispatchEvent(
                              new CustomEvent("doc-anchor", {
                                detail: {
                                  docId: activeFile.id,
                                  fileName: activeFile.name,
                                  page: p,
                                  text: payload.text,
                                  rects: payload.rects,
                                },
                              })
                            );
                          } catch (e) {
                            console.error("Anchor event failed:", e);
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </PinchZoom>
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
