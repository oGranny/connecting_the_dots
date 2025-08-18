import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Page } from "react-pdf";
import SelectionAnchor from "./SelectionAnchor";
import { clamp } from "./utils/geometry";

export default function PDFPage({
  scrollRef,
  pageNumber,
  pageWidth,
  renderWidth,
  onFirstPageLoad,
  tool,
  dpr,
  strokes,
  onAddStroke,
  highlights,
  onAddHighlight,
  onAnchor,
}) {
  const layerRef = useRef(null);
  const canvasRef = useRef(null);

  const isDraw = tool === "draw";
  const [isDrawing, setIsDrawing] = useState(false);
  const strokePts = useRef([]);
  const brushSize = 2;

  const rerenderCanvas = useCallback(() => {
    const el = layerRef.current;
    const cvs = canvasRef.current;
    if (!el || !cvs) return;
    const w = Math.floor(el.clientWidth);
    const h = Math.floor(el.clientHeight);
    const W = Math.floor(w * dpr);
    const H = Math.floor(h * dpr);
    if (cvs.width !== W || cvs.height !== H) {
      cvs.width = W; cvs.height = H;
      cvs.style.width = `${w}px`; cvs.style.height = `${h}px`;
    }
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes) {
      if (!s.pts || s.pts.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < s.pts.length; i++) {
        const p = s.pts[i]; const x = p.x * W, y = p.y * H;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineWidth = (s.size ?? brushSize) * dpr;
      ctx.strokeStyle = "#e5e7eb";
      ctx.stroke();
    }
  }, [strokes, dpr]);

  useLayoutEffect(() => { rerenderCanvas(); }, [pageWidth, strokes, rerenderCanvas]);

  const clientToRel = (e, el) => {
    // When PinchZoom applies a CSS transform, getBoundingClientRect() reflects
    // the transformed size while el.clientWidth/clientHeight are the untransformed layout size.
    // Convert client coords back to the untransformed coordinate system so the
    // canvas (which is sized using clientWidth/clientHeight) receives correct normalized points.
    const r = el.getBoundingClientRect();
    const unscaledW = el.clientWidth || r.width;
    const unscaledH = el.clientHeight || r.height;
    const scaleX = r.width / unscaledW || 1;
    const scaleY = r.height / unscaledH || 1;
    
    // Get the actual coordinates inside the element's bounding rect
    const xInBounds = e.clientX - r.left;
    const yInBounds = e.clientY - r.top;
    
    // Transform coordinates back to unscaled space
    const xUnscaled = xInBounds / scaleX;
    const yUnscaled = yInBounds / scaleY;
    
    // Normalize to 0-1 range and clamp
    return { 
      x: clamp(xUnscaled / unscaledW, 0, 1), 
      y: clamp(yUnscaled / unscaledH, 0, 1) 
    };
  };

  const handlePointerDown = (e) => {
    if (!isDraw) return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    setIsDrawing(true);
    cvs.setPointerCapture?.(e.pointerId);
    strokePts.current = [clientToRel(e, cvs)];
  };
  const handlePointerMove = (e) => {
    if (!isDraw || !isDrawing) return;
    const cvs = canvasRef.current; if (!cvs) return;
    strokePts.current.push(clientToRel(e, cvs));
    const ctx = cvs.getContext("2d");
    const n = strokePts.current.length;
    if (n >= 2) {
      const a = strokePts.current[n - 2], b = strokePts.current[n - 1];
      ctx.beginPath();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = brushSize * dpr; ctx.strokeStyle = "#e5e7eb";
      ctx.moveTo(a.x * cvs.width, a.y * cvs.height);
      ctx.lineTo(b.x * cvs.width, b.y * cvs.height);
      ctx.stroke();
    }
  };
  const handlePointerUp = () => {
    if (!isDraw) return;
    setIsDrawing(false);
    const pts = strokePts.current.slice();
    strokePts.current = [];
    if (pts.length < 2) return;
    onAddStroke({ pts, size: brushSize });
  };

  return (
    <div
      ref={layerRef}
      className={`relative rounded-xl shadow-sm ring-1 ring-black/10 overflow-hidden ${tool === "hand" ? "select-none" : ""}`}
      style={{ width: pageWidth }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <Page
        pageNumber={pageNumber}
        width={renderWidth || pageWidth}
        renderTextLayer
        renderAnnotationLayer={false}
        renderMode="svg"
        onLoadSuccess={pageNumber === 1 && onFirstPageLoad ? onFirstPageLoad : undefined}
        // The following line improves PDF render quality especially during zooming
        className="transition-[filter] duration-100" 
        // The following styles avoid blurry text during fast zoom operations
        style={{ 
          imageRendering: 'auto',
          fontSmoothing: 'antialiased',
          textRendering: 'optimizeLegibility'
        }}
      />

      <canvas
        ref={canvasRef}
        className={`absolute inset-0 ${isDraw ? "pointer-events-auto" : "pointer-events-none"}`}
      />

      <div className="absolute inset-0 pointer-events-none">
        {highlights.map((r, i) => (
          <div key={`hl-${pageNumber}-${i}`} className="absolute bg-yellow-300/40 rounded-[2px]"
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
        ))}
      </div>

      <SelectionAnchor
        containerRef={scrollRef}
        pageLayerRef={layerRef}
        enabled={tool === "highlight" || tool === "select"}
        onHighlight={(payload) => onAddHighlight(payload.rects)}
        onAnchor={(payload) => onAnchor(payload)}
      />
    </div>
  );
}
