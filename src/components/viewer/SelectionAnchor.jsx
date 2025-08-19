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
  const selectingRef = useRef(false);        // true while a selection drag is in progress
  const startedInTextRef = useRef(false);    // selection started inside text layer?

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }

    const pageEl = pageLayerRef?.current;
    if (!pageEl) return;

    const textLayer = pageEl.querySelector('.react-pdf__Page__textContent');
    if (!textLayer) return;

    // Force user-select only on text layer; nowhere else on the page container
    pageEl.style.userSelect = 'none';
    pageEl.style.webkitUserSelect = 'none';
    textLayer.style.userSelect = 'text';
    textLayer.style.webkitUserSelect = 'text';

    // Helper: is DOM node inside the text layer?
    const nodeInside = (node) => {
      if (!node) return false;
      const n = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
      return textLayer.contains(n);
    };

    // Guard: only allow starting a selection inside the text layer
    const onPointerDown = (e) => {
      startedInTextRef.current = nodeInside(e.target);
      selectingRef.current = startedInTextRef.current && e.button === 0; // left-button only
      if (!startedInTextRef.current) {
        // prevent browser from initiating a page-wide selection from non-text areas
        e.preventDefault();
        const sel = window.getSelection?.();
        try { sel && sel.removeAllRanges && sel.removeAllRanges(); } catch {}
      }
    };

    // End selection drag when mouse/touch released
    const onPointerUp = () => {
      selectingRef.current = false;
    };

    // Main selection change handler (runs very frequently)
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        setVisible(false);
        return;
      }

      // If selection did not start in text layer, keep UI hidden and clear selection
      if (!startedInTextRef.current) {
        setVisible(false);
        try { sel.removeAllRanges(); } catch {}
        return;
      }

      // Both ends must remain within the text layer
      if (!nodeInside(sel.anchorNode) || !nodeInside(sel.focusNode)) {
        setVisible(false);
        try { sel.removeAllRanges(); } catch {}
        return;
      }

      // Ignore collapsed selections
      if (sel.isCollapsed) {
        setVisible(false);
        return;
      }

      // Compute rects and keep only those intersecting the text layer (with tolerance)
      const range = sel.getRangeAt(0);
      const clientRects = Array.from(range.getClientRects());
      if (!clientRects.length) {
        setVisible(false);
        return;
      }

      const textRect = expandRect(textLayer.getBoundingClientRect(), 10); // 10px tolerance
      const filtered = clientRects.filter((r) => rectIntersects(r, textRect));
      if (!filtered.length) {
        setVisible(false);
        try { sel.removeAllRanges(); } catch {}
        return;
      }

      // Project to page-relative coords
      const pageRect = pageEl.getBoundingClientRect();
      const rectsOnPage = filtered
        .map((r) => intersectRect(r, pageRect))
        .filter(Boolean);
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

    // Attach listeners
    pageEl.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('selectionchange', onSelectionChange, { passive: true });

    // Cleanup
    return () => {
      pageEl.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      try {
        // restore defaults
        pageEl.style.userSelect = '';
        pageEl.style.webkitUserSelect = '';
        textLayer.style.userSelect = '';
        textLayer.style.webkitUserSelect = '';
      } catch {}
    };
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
function expandRect(r, pad) {
  return {
    left: r.left - pad,
    top: r.top - pad,
    right: r.right + pad,
    bottom: r.bottom + pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}
function rectIntersects(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

// Note: we clear native selection when it escapes the text layer to prevent accidental full-page selection
