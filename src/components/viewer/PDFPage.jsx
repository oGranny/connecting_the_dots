import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Page } from "react-pdf";
import SelectionAnchor from "./SelectionAnchor";
import { clamp } from "./utils/geometry";

export default function PDFPage({
  scrollRef,
  pageNumber,
  pageWidth,
  onFirstPageLoad,
  tool,
  drawColor = "#3B82F6",
  dpr,
  strokes,
  onAddStroke,
  onEraseStrokes, // Add onEraseStrokes prop
  highlights,
  onAddHighlight,
  onAnchor,
}) {
  const layerRef = useRef(null);
  const canvasRef = useRef(null);

  const isDraw = tool === "draw";
  const isEraser = tool === "eraser";
  const [isDrawing, setIsDrawing] = useState(false);

  const strokePts = useRef([]);
  const brushSize = 2;
  const eraserSize = 20; // Eraser radius in pixels

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
      ctx.strokeStyle = s.color || "#e5e7eb";
      ctx.stroke();
    }
  }, [strokes, dpr]);

  useLayoutEffect(() => { rerenderCanvas(); }, [pageWidth, strokes, rerenderCanvas]);

  const clientToRel = (e, el) => {
    const r = el.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };

  // Function to check if a point is near a stroke path
  const isPointNearStroke = (point, stroke, tolerancePx = eraserSize) => {
    if (!stroke.pts || stroke.pts.length < 2) return false;
    
    const cvs = canvasRef.current;
    if (!cvs) return false;
    
    const tolerance = tolerancePx / cvs.width; // Convert pixels to relative coordinates
    
    for (let i = 0; i < stroke.pts.length - 1; i++) {
      const p1 = stroke.pts[i];
      const p2 = stroke.pts[i + 1];
      
      // Calculate distance from point to line segment
      const A = point.x - p1.x;
      const B = point.y - p1.y;
      const C = p2.x - p1.x;
      const D = p2.y - p1.y;
      
      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = -1;
      if (lenSq !== 0) param = dot / lenSq;
      
      let xx, yy;
      if (param < 0) {
        xx = p1.x;
        yy = p1.y;
      } else if (param > 1) {
        xx = p2.x;
        yy = p2.y;
      } else {
        xx = p1.x + param * C;
        yy = p1.y + param * D;
      }
      
      const dx = point.x - xx;
      const dy = point.y - yy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= tolerance) return true;
    }
    return false;
  };

  const handlePointerDown = (e) => {
    if (isDraw) {
      const cvs = canvasRef.current;
      if (!cvs) return;
      setIsDrawing(true);
      cvs.setPointerCapture?.(e.pointerId);
      strokePts.current = [clientToRel(e, cvs)];
      e.stopPropagation();
    } else if (isEraser) {
      const cvs = canvasRef.current;
      if (!cvs) return;
      const point = clientToRel(e, cvs);
      
      // Find strokes to erase
      const strokesToErase = [];
      strokes.forEach((stroke, index) => {
        if (isPointNearStroke(point, stroke)) {
          strokesToErase.push(index);
        }
      });
      
      if (strokesToErase.length > 0) {
        onEraseStrokes?.(strokesToErase);
      }
      
      e.stopPropagation();
    }
  };

  const handlePointerMove = (e) => {
    if (isDraw && isDrawing) {
      const cvs = canvasRef.current; if (!cvs) return;
      strokePts.current.push(clientToRel(e, cvs));
      const ctx = cvs.getContext("2d");
      const n = strokePts.current.length;
      if (n >= 2) {
        const a = strokePts.current[n - 2], b = strokePts.current[n - 1];
        ctx.beginPath();
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.lineWidth = brushSize * dpr; 
        ctx.strokeStyle = drawColor;
        ctx.moveTo(a.x * cvs.width, a.y * cvs.height);
        ctx.lineTo(b.x * cvs.width, b.y * cvs.height);
        ctx.stroke();
      }
      e.stopPropagation();
    } else if (isEraser) {
      // Continuous erasing while dragging
      const cvs = canvasRef.current;
      if (!cvs) return;
      const point = clientToRel(e, cvs);
      
      const strokesToErase = [];
      strokes.forEach((stroke, index) => {
        if (isPointNearStroke(point, stroke)) {
          strokesToErase.push(index);
        }
      });
      
      if (strokesToErase.length > 0) {
        onEraseStrokes?.(strokesToErase);
      }
      
      e.stopPropagation();
    }
  };

  const handlePointerUp = (e) => {
    if (isDraw) {
      setIsDrawing(false);
      const pts = strokePts.current.slice();
      strokePts.current = [];
      if (pts.length < 2) return;
      onAddStroke({ pts, size: brushSize, color: drawColor });
      e.stopPropagation();
    }
  };

  return (
    <div
      ref={layerRef}
      className={`relative rounded-xl shadow-sm ring-1 ring-black/10 overflow-hidden ${
        tool === "hand" ? "select-none" : ""
      }`}
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
        className={`absolute inset-0 ${(isDraw || isEraser) ? "pointer-events-auto" : "pointer-events-none"}`}
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
        enabled={tool === "highlight" || tool === "select"} // Exclude draw and eraser
        onHighlight={(payload) => onAddHighlight(payload.rects)}
        onAnchor={(payload) => onAnchor(payload)}
      />
    </div>
  );
}
