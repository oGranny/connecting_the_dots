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
  Eraser, // Add Eraser import
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

export default function CenterViewer({ activeFile, onReady, onStatus, onAnchor, zoom, setZoom }) {
  const scrollRef = useRef(null);

  // Viewer state
  const [numPages, setNumPages] = useState(null);
  const [currPage, setCurrPage] = useState(1);
  const [viewMode, setViewMode] = useState("continuous"); // "continuous" | "single"
  const [fitMode, setFitMode] = useState("width");        // "width" | "page"
  // const [zoom, setZoom] = useState(1); // Remove local zoom state - it's now passed as props
  const [docError, setDocError] = useState(null);

  // Geometry
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [pageAspect, setPageAspect] = useState(0.75);
  const dpr = Math.max(1, typeof window !== "undefined" ? window.devicePixelRatio : 1);

  // Tools - Update to include eraser
  const [tool, setTool] = useState("select"); // "select" | "hand" | "draw" | "highlight" | "eraser"
  const [drawColor, setDrawColor] = useState("#3B82F6"); // Default blue color
  const isDraw = tool === "draw";
  const isEraser = tool === "eraser";

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
    // setZoom(1); // REMOVE THIS LINE
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
  useEffect(() => {
    // Only reset zoom if it's the first time or user wants to reset
    // setZoom(1); // REMOVE THIS LINE or make it conditional
  }, [fitMode, viewMode]);

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

  // Search and highlight
  useEffect(() => {
    const handleHighlightRange = (event) => {
      const { page, start, end, text, highlightColor } = event.detail || {};
      
      // Validate we have the required data
      if (!page || (start === undefined && end === undefined && !text)) {
        console.log('Invalid highlight data:', event.detail);
        return;
      }
      
      console.log(`Highlighting range on page ${page}: ${start}-${end}`, text?.substring(0, 50));
      
      // Clear previous highlights
      document.querySelectorAll('.context-highlight').forEach(el => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(el.textContent), el);
          parent.normalize();
        }
      });
      
      // Find the specific page element
      const pageElement = pageRefs.current?.[page];
      if (!pageElement) {
        console.log(`Page ${page} not found in refs`);
        return;
      }
      
      // Look for text layer within this specific page
      const textLayer = pageElement.querySelector('.react-pdf__Page__textContent');
      if (!textLayer) {
        console.log(`Text layer not found for page ${page}`);
        return;
      }
      
      // Get all text spans in the page
      const textSpans = textLayer.querySelectorAll('span');
      if (!textSpans.length) {
        console.log(`No text spans found on page ${page}`);
        return;
      }
      
      // If we have start/end positions, use character-based highlighting
      if (start !== undefined && end !== undefined) {
        let currentPos = 0;
        let highlightStarted = false;
        const spansToHighlight = [];
        
        for (const span of textSpans) {
          const spanText = span.textContent || '';
          const spanStart = currentPos;
          const spanEnd = currentPos + spanText.length;
          
          // Check if this span overlaps with our highlight range
          if (spanEnd > start && spanStart < end) {
            spansToHighlight.push({
              span,
              highlightStart: Math.max(0, start - spanStart),
              highlightEnd: Math.min(spanText.length, end - spanStart)
            });
          }
          
          currentPos = spanEnd;
          
          // Stop if we've passed the end position
          if (currentPos > end) break;
        }
        
        // Apply highlights to the identified spans
        spansToHighlight.forEach(({ span, highlightStart, highlightEnd }, index) => {
          const spanText = span.textContent;
          
          if (highlightStart === 0 && highlightEnd === spanText.length) {
            // Highlight the entire span
            span.style.backgroundColor = highlightColor;
            span.style.borderRadius = '2px';
            span.classList.add('context-highlight');
          } else {
            // Partial span highlighting - need to split the text
            const beforeText = spanText.substring(0, highlightStart);
            const highlightText = spanText.substring(highlightStart, highlightEnd);
            const afterText = spanText.substring(highlightEnd);
            
            // Clear the original span
            span.textContent = '';
            
            // Add text parts
            if (beforeText) {
              span.appendChild(document.createTextNode(beforeText));
            }
            
            if (highlightText) {
              const highlightSpan = document.createElement('span');
              highlightSpan.textContent = highlightText;
              highlightSpan.style.backgroundColor = highlightColor;
              highlightSpan.style.borderRadius = '2px';
              highlightSpan.classList.add('context-highlight');
              span.appendChild(highlightSpan);
            }
            
            if (afterText) {
              span.appendChild(document.createTextNode(afterText));
            }
          }
          
          // Scroll to the first highlighted span
          if (index === 0) {
            span.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
        
        console.log(`Highlighted ${spansToHighlight.length} spans`);
        
      } else if (text) {
        // Fallback to text-based search if no start/end positions
        const searchText = text.toLowerCase().trim();
        let found = false;
        
        for (const span of textSpans) {
          const spanText = (span.textContent || '').toLowerCase().trim();
          if (spanText.includes(searchText) || searchText.includes(spanText)) {
            span.style.backgroundColor = highlightColor;
            span.style.borderRadius = '2px';
            span.classList.add('context-highlight');
            
            if (!found) {
              span.scrollIntoView({ behavior: 'smooth', block: 'center' });
              found = true;
            }
          }
        }
        
        console.log(`Text-based highlighting: ${found ? 'found' : 'not found'}`);
      }
    };
    
    window.addEventListener("viewer:highlight-range", handleHighlightRange);
    return () => window.removeEventListener("viewer:highlight-range", handleHighlightRange);
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

  // TEMPORARY TEST - Add this right after your other useEffects
  useEffect(() => {
    console.log("Setting up DIRECT zoom test");
    
    const testWheelHandler = (e) => {
      console.log("DIRECT wheel event:", {
        ctrlKey: e.ctrlKey,
        deltaY: e.deltaY,
        target: e.target?.tagName,
        targetClass: e.target?.className
      });
      
      if (e.ctrlKey) {
        console.log("DIRECT: Ctrl+wheel detected!");
        e.preventDefault();
        
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(prevZoom => {
          const newZoom = Math.max(0.25, Math.min(4, prevZoom + delta));
          console.log("DIRECT zoom change:", prevZoom, "->", newZoom);
          return newZoom;
        });
      }
    };
    
    // Add to document to catch everything
    document.addEventListener("wheel", testWheelHandler, { passive: false });
    
    return () => {
      document.removeEventListener("wheel", testWheelHandler);
    };
  }, [setZoom]); // Add setZoom to dependencies

  // Comment out the zoom interactions hook temporarily
  // useZoomInteractions(scrollRef, setZoom);
  
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
              label="Draw"
            />
            {/* Eraser button - only visible when draw is active */}
            {isDraw && (
              <SegButton
                active={tool === "eraser"}
                onClick={() => setTool(tool === "eraser" ? "draw" : "eraser")}
                icon={<Eraser size={16} />}
                label="Eraser"
              />
            )}
          </Segment>

          {/* Color picker when draw is selected */}
          {tool === "draw" && (
            <Segment title="Color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={drawColor}
                  onChange={(e) => setDrawColor(e.target.value)}
                  className="w-8 h-8 rounded-lg border border-white/20 bg-transparent cursor-pointer"
                  title="Drawing color"
                />
                <div className="flex gap-1">
                  {/* Preset colors */}
                  {[
                    "#3B82F6", // Blue
                    "#EF4444", // Red
                    "#10B981", // Green
                    "#F59E0B", // Yellow
                    "#8B5CF6", // Purple
                    "#F97316", // Orange
                    "#EC4899", // Pink
                    "#000000", // Black
                  ].map((color) => (
                    <button
                      key={color}
                      onClick={() => setDrawColor(color)}
                      className={`w-6 h-6 rounded border-2 ${
                        drawColor === color ? "border-white" : "border-white/20"
                      }`}
                      style={{ backgroundColor: color }}
                      title={`Use ${color}`}
                    />
                  ))}
                </div>
              </div>
            </Segment>
          )}

          <Segment title="Zoom">
            <IconButton onClick={zoomOut} title="Zoom out"><ZoomOut size={16} /></IconButton>
            <div className="px-2 min-w-[52px] text-center text-sm text-slate-200 tabular-nums">{Math.round(zoom * 100)}%</div>
            <IconButton onClick={zoomIn} title="Zoom in"><ZoomIn size={16} /></IconButton>
            <IconButton onClick={resetZoom} title="Reset zoom"><RotateCcw size={16} /></IconButton>
          </Segment>

          {/* <div className="ml-1">
            <select
              value={fitMode}
              onChange={(e) => setFitMode(e.target.value)}
              className="h-9 rounded-xl px-3 bg-white/5 border border-white/10 text-sm text-slate-200 outline-none focus:border-white/20"
              title="Fit"
            >
              <option value="width">Fit width</option>
              <option value="page">Fit page</option>
            </select>
          </div> */}

          <div className="ml-auto flex items-center gap-2">
            {(tool === "draw" || tool === "eraser") && (
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
          tool === "hand" ? "cursor-grab select-none" : 
          tool === "draw" ? "cursor-crosshair select-none" : 
          tool === "eraser" ? "cursor-pointer select-none" :
          "cursor-default"
        } touch-none overscroll-contain themed-scroll`}
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
                      drawColor={drawColor}
                      dpr={dpr}
                      strokes={strokesByPage[p] || []}
                      onAddStroke={(s) => addStroke(p, s)}
                      onEraseStrokes={(strokeIndices) => eraseStrokes(p, strokeIndices)} // Add erase callback
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

  // Add the erase function
  function eraseStrokes(page, strokeIndices) {
    setStrokesByPage((prev) => {
      const pageStrokes = prev[page] || [];
      const filteredStrokes = pageStrokes.filter((stroke, index) => !strokeIndices.includes(index));
      return { ...prev, [page]: filteredStrokes };
    });
  }

  // ...rest of your existing code...
}

/* ---------- Loading/Error ---------- */
function DocLoading() {
  return <div className="w-full h-full grid place-items-center text-slate-400 text-xs">Loading PDF…</div>;
}
function DocError({ text = "Failed to load PDF file." }) {
  return <div className="w-full h-full grid place-items-center text-slate-400 text-sm">{text}</div>;
}
