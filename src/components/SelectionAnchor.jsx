// src/components/SelectionAnchor.jsx
import React, { useEffect, useRef, useState } from "react";

export default function SelectionAnchor({
  containerRef,
  pageLayerRef,
  enabled = true,
  onHighlight,
  onAnchor,
}) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // relative to page layer
  const latestPayload = useRef(null);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }
    const onSelectionChange = () => {
      if (!pageLayerRef?.current) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setVisible(false);
        return;
      }
      const range = sel.getRangeAt(0);
      const rects = Array.from(range.getClientRects());
      if (!rects.length) return;

      const pageRect = pageLayerRef.current.getBoundingClientRect();
      const rectsOnPage = rects.map((r) => intersectRect(r, pageRect)).filter(Boolean);
      if (!rectsOnPage.length) {
        setVisible(false);
        return;
      }

      const relRects = rectsOnPage.map((r) => ({
        x: (r.left - pageRect.left) / pageRect.width,
        y: (r.top - pageRect.top) / pageRect.height,
        w: r.width / pageRect.width,
        h: r.height / pageRect.height,
      }));
      const text = sel.toString();
      const last = rectsOnPage[rectsOnPage.length - 1];

      setPos({
        x: clamp((last.left + last.width / 2 - pageRect.left) / pageRect.width, 0, 1),
        y: clamp((last.bottom - pageRect.top) / pageRect.height, 0, 1),
      });

      latestPayload.current = { text, rects: relRects };
      setVisible(true);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [enabled, pageLayerRef]);

  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;
    const onScroll = () => setVisible(false);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [containerRef]);

  if (!visible || !enabled) return null;

  return (
    <div
      className="absolute z-20"
      style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, transform: "translate(-50%, 8px)" }}
    >
      <div className="bg-neutral-900/90 backdrop-blur border border-white/10 rounded-xl shadow-xl p-1 flex items-center gap-1">
        <button
          className="text-xs px-3 h-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setVisible(false);
            if (latestPayload.current && onHighlight) onHighlight(latestPayload.current);
            window.getSelection()?.removeAllRanges?.();
          }}
          title="Highlight selected text"
        >
          Highlight
        </button>
        <button
          className="text-xs px-3 h-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200"
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            setVisible(false);
            if (!latestPayload.current) return;
            try {
              await navigator.clipboard?.writeText(latestPayload.current.text);
            } catch {}
            onAnchor?.(latestPayload.current);
            window.getSelection()?.removeAllRanges?.();
          }}
          title="Anchor: highlight + send to backend"
        >
          Anchor
        </button>
      </div>
    </div>
  );
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function intersectRect(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return null;
  return { left, top, right, bottom, width: w, height: h };
}
