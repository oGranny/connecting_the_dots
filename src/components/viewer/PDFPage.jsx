import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Page } from "react-pdf";
import SelectionAnchor from "./SelectionAnchor";
import { clamp } from "./utils/geometry";

export default function PDFPage({
  scrollRef,
  pageNumber,
  pageWidth,
  onFirstPageLoad,
  tool,
  dpr,
  strokes,
  onAddStroke,
  onEraseAt,
  highlights,
  onAddHighlight,
  onAnchor,
  penColor,
}) {
  const layerRef = useRef(null);
  const canvasRef = useRef(null);

  const isDraw = tool === "draw";
  const isErase = tool === "erase";
  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
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
      ctx.strokeStyle = s.color ?? "#e5e7eb";
      ctx.stroke();
    }
  }, [strokes, dpr]);

  useLayoutEffect(() => { rerenderCanvas(); }, [pageWidth, strokes, rerenderCanvas]);

  const clientToRel = (e, el) => {
    const r = el.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };

  const handlePointerDown = (e) => {
    if (!isDraw && !isErase) return;
    e.preventDefault();
    e.stopPropagation();
    const cvs = canvasRef.current;
    if (!cvs) return;
    if (isDraw) setIsDrawing(true);
    if (isErase) setIsErasing(true);
    cvs.setPointerCapture?.(e.pointerId);
    strokePts.current = [clientToRel(e, cvs)];
  };
  const handlePointerMove = (e) => {
    if (!isDraw && !isErase) return;
    e.preventDefault();
    e.stopPropagation();
    const cvs = canvasRef.current; if (!cvs) return;
    if (isErase && isErasing) {
      const pt = clientToRel(e, cvs);
      const radiusRel = (brushSize * dpr * 3) / Math.min(cvs.width, cvs.height); // a bit larger than brush
      onEraseAt?.(pt, radiusRel);
      return;
    }
    if (!isDrawing) return;
    strokePts.current.push(clientToRel(e, cvs));
    const ctx = cvs.getContext("2d");
    const n = strokePts.current.length;
    if (n >= 2) {
      const a = strokePts.current[n - 2], b = strokePts.current[n - 1];
      ctx.beginPath();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = brushSize * dpr; ctx.strokeStyle = penColor || "#e5e7eb";
      ctx.moveTo(a.x * cvs.width, a.y * cvs.height);
      ctx.lineTo(b.x * cvs.width, b.y * cvs.height);
      ctx.stroke();
    }
  };
  const handlePointerUp = (e) => {
    if (!isDraw && !isErase) return;
    e.preventDefault();
    e.stopPropagation();
    if (isErase) { setIsErasing(false); return; }
    setIsDrawing(false);
    const pts = strokePts.current.slice();
    strokePts.current = [];
    if (pts.length < 2) return;
    onAddStroke({ pts, size: brushSize, color: penColor });
  };

  return (
    <div
      ref={layerRef}
      className={`relative rounded-xl shadow-sm ring-1 ring-black/10 overflow-hidden ${(isDraw || isErase) ? "select-none" : ""}`}
      style={{ width: pageWidth }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <Page
        pageNumber={pageNumber}
        width={pageWidth}
        renderTextLayer
        renderAnnotationLayer={false}
        renderMode="svg"
        onLoadSuccess={pageNumber === 1 && onFirstPageLoad ? onFirstPageLoad : undefined}
      />

      <canvas
        ref={canvasRef}
        className={`absolute inset-0 ${(isDraw || isErase) ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{
          cursor: isDraw
            ? "url('/pen-cursor.png') 4 24, crosshair"
            : isErase
            ? "url('/eraser-cursor.png') 10 10, crosshair"
            : undefined,
        }}
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
