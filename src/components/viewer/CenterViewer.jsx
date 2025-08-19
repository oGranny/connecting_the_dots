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
  Eraser,
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
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [pageAspect, setPageAspect] = useState(0.75);
  const dpr = Math.max(1, typeof window !== "undefined" ? window.devicePixelRatio : 1);

  // Tools
  const [tool, setTool] = useState("select"); // "select" | "hand" | "draw" | "highlight"
  const [penColor, setPenColor] = useState("#ef4444"); // default red
  const PEN_COLORS = ["#ef4444", "#22c55e", "#eab308", "#3b82f6", "#a855f7"]; // red, green, yellow, blue, purple
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
  const pageWidth = Math.floor(targetBaseWidth * zoom);

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
  const zoomIn = () => setZoom((z) => clamp(Math.round((z + 0.1) * 10) / 10, 0.25, 4));
  const zoomOut = () => setZoom((z) => clamp(Math.round((z - 0.1) * 10) / 10, 0.25, 4));
  const resetZoom = () => setZoom(1);
  const scrollToPage = (p) => {
    const el = pageRefs.current?.[p];
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    setCurrPage(p);
  };

  // --- Erasing ---
  const _strokeHit = (s, pt, r) => {
    const r2 = r * r;
    const P = s?.pts || [];
    for (let i = 0; i < P.length; i++) {
      const dx = (P[i].x - pt.x);
      const dy = (P[i].y - pt.y);
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  };
  const eraseAt = (page, pt, r) => {
    setStrokesByPage((prev) => {
      const arr = prev[page] ? [...prev[page]] : [];
      const keep = arr.filter((s) => !_strokeHit(s, pt, r));
      return { ...prev, [page]: keep };
    });
  };

  // Allow ChatPanel to command page jumps in the CURRENT open PDF
  useEffect(() => {
    function onGoto(e) {
      const { page, docId } = e.detail || {};
      if (!page) return;
      if (docId && activeFile?.id && docId !== activeFile.id) return; // ignore if targeting another doc
      const p = clamp(parseInt(page, 10) || 1, 1, numPages || 1);
      if (viewMode === "continuous") scrollToPage(p);
      else setCurrPage(p);
    }
    window.addEventListener("viewer:goto", onGoto);
    return () => window.removeEventListener("viewer:goto", onGoto);
  }, [viewMode, numPages, activeFile?.id]);

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
          <Segment title="Tools">
            <SegButton
              active={tool === "draw"}
              onClick={() => setTool(tool === "draw" ? "select" : "draw")}
              icon={<Pencil size={16} />}
              hint="Draw"
            />
            <SegButton
              active={tool === "erase"}
              onClick={() => setTool(tool === "erase" ? "select" : "erase")}
              icon={<Eraser size={16} />}
              hint="Erase"
            />
            {tool === "draw" && (
              <div className="flex items-center gap-2 pl-2 pr-3">
                {PEN_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setPenColor(c)}
                    title={c}
                    className={`h-5 w-5 rounded-full border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 ${penColor === c ? "ring-2 ring-white/70" : ""}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}
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

          <div className="ml-auto flex items-center gap-2">
            {tool === "draw" && (
              <>
                <button onClick={undoStroke} className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm" title="Undo (current page)">Undo</button>
                <button onClick={clearStrokes} className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm" title="Clear drawings (current page)">Clear</button>
              </>
            )}
            <a
              className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm inline-flex items-center gap-2"
              href={activeFile.url}
              download={activeFile.name || "document.pdf"}
              title="Download"
            >
              <Download size={16} /> Download
            </a>
          </div>
        </div>
      </div>

      {/* Viewer */}
      <div
        ref={scrollRef}
        className={`relative flex-1 min-h-0 overflow-auto ${
          tool === "hand" ? "cursor-grab select-none" : (tool === "draw" || tool === "erase") ? "cursor-crosshair select-none" : "cursor-default"
        } touch-none overscroll-contain themed-scroll`}
        style={{
          cursor:
            tool === "draw"
              ? "url('/pen-cursor.png') 4 24, crosshair"
              : tool === "erase"
              ? "url('/eraser-cursor.png') 10 10, crosshair"
              : undefined,
        }}
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
            <div className="mx-auto my-6" style={{ width: pageWidth }}>
              {Array.from({ length: numPages || 0 }, (_, i) => {
                const p = i + 1;
                return (
                  <div key={`p-${p}`} data-page={p} ref={(el) => (pageRefs.current[p] = el || undefined)} className="mb-6">
                    <PDFPage
                      scrollRef={scrollRef}
                      pageNumber={p}
                      pageWidth={pageWidth}
                      onFirstPageLoad={p === 1 ? onFirstPageLoad : undefined}
                      tool={tool}
                      penColor={penColor}
                      dpr={dpr}
                      strokes={strokesByPage[p] || []}
                      onAddStroke={(s) => addStroke(p, s)}
                      onEraseAt={(pt, r) => eraseAt(p, pt, r)}
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
