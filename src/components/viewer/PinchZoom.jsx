import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";

/**
 * PinchZoom
 * - Two‑finger pinch to zoom without breaking natural scroll.
 * - One‑finger pan only when zoomed in; otherwise let the page scroll.
 * - Ctrl/⌘ + wheel to zoom. Double‑tap to quick zoom.
 *
 * Usage:
 *   <PinchZoom max={5} min={1} onScale={(s)=>{}}
 *              className="h-full w-full">
 *     {children}
 *   </PinchZoom>
 */
export default function PinchZoom({
  children,
  min = 1,
  max = 4,
  initial = 1,
  wheelZoom = true,
  doubleTapZoom = 2,
  className = "",
  onScale,
  onScaleEnd,
  centerZoom = false,
  momentum = true, // enable inertial pan when releasing a drag while zoomed
}) {
  const outerRef = useRef(null); // gesture capture surface
  const innerRef = useRef(null); // transformed content

  // transform state in refs for perf; we paint via RAF
  const s = useRef(initial);
  const tx = useRef(0);
  const ty = useRef(0);

  // base unscaled sizes
  const base = useRef({ w: 0, h: 0 });
  const box = useRef({ w: 0, h: 0 });

  const raf = useRef(0);
  const dirty = useRef(false);

  const pointers = useRef(new Map()); // id -> {x,y}
  const pinch = useRef(null); // {s0, d0, c0:{x,y}}
  const pan = useRef(null); // {x0,y0}
  const velocity = useRef({ vx: 0, vy: 0 }); // px/ms
  const lastSample = useRef({ t: 0, x: 0, y: 0 });
  const inertiaRaf = useRef(0);

  const [touchAction, setTouchAction] = useState("pan-y"); // allow vertical scroll by default

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const readRects = useCallback(() => {
    const o = outerRef.current;
    const i = innerRef.current;
    if (!o || !i) return;
    const ob = o.getBoundingClientRect();
    // To get base content size, temporarily reset transform
    const prev = i.style.transform;
    i.style.transform = "translate3d(0,0,0) scale(1)";
    const ib = i.getBoundingClientRect();
    i.style.transform = prev;
    box.current = { w: ob.width, h: ob.height };
    base.current = { w: ib.width, h: ib.height };
  }, []);

  const clampPan = useCallback(() => {
    // Constrain panning so content edges are reachable but not beyond.
    const bw = base.current.w;
    const bh = base.current.h;
    const vw = box.current.w;
    const vh = box.current.h;
    const sc = s.current;
    const cw = bw * sc;
    const ch = bh * sc;
    const minX = Math.min(0, vw - cw);
    const maxX = 0;
    const minY = Math.min(0, vh - ch);
    const maxY = 0;
    tx.current = clamp(tx.current, minX, maxX);
    ty.current = clamp(ty.current, minY, maxY);
  }, []);

  const paint = useCallback(() => {
    if (!innerRef.current) return;
    dirty.current = false;
    innerRef.current.style.transform = `translate3d(${tx.current}px, ${ty.current}px, 0) scale(${s.current})`;
    if (onScale) onScale(s.current);
  }, [onScale]);

  const requestPaint = useCallback(() => {
    if (dirty.current) return;
    dirty.current = true;
    raf.current = requestAnimationFrame(paint);
  }, [paint]);

  const worldPoint = (clientX, clientY) => {
    const ob = outerRef.current.getBoundingClientRect();
    // position inside container (unscaled coordinate space)
    const x = clientX - ob.left;
    const y = clientY - ob.top;
    // convert to content space before scale & translation
    return { x: (x - tx.current) / s.current, y: (y - ty.current) / s.current };
  };
  
  // Calculate the center of the viewport in content space
  const viewportCenter = () => {
    if (!outerRef.current) return { x: 0, y: 0 };
    const rect = outerRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    return { x: (centerX - tx.current) / s.current, y: (centerY - ty.current) / s.current };
  };

  const setScaleAt = (nextS, center) => {
    const ns = clamp(nextS, min, max);
    // keep the point under the fingers stationary in screen space
    const cx = center.x * s.current + tx.current;
    const cy = center.y * s.current + ty.current;
    
    // Apply transformation immediately with GPU acceleration
    tx.current = cx - center.x * ns;
    ty.current = cy - center.y * ns;
    s.current = ns;
    
    // Ensure we don't go out of bounds
    clampPan();
    
    // Use RAF for smoother rendering
    requestPaint();
  };

  // Pointer handlers
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    const onPointerDown = (e) => {
      // cancel any running inertia
      if (inertiaRaf.current) {
        cancelAnimationFrame(inertiaRaf.current);
        inertiaRaf.current = 0;
      }
      // Don't steal regular scrolling until pinch or when already zoomed
      el.setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // double‑tap to zoom
      const now = Date.now();
      const dt = onPointerDown._lastTap ? now - onPointerDown._lastTap.t : Infinity;
      const dist = onPointerDown._lastTap
        ? Math.hypot(e.clientX - onPointerDown._lastTap.x, e.clientY - onPointerDown._lastTap.y)
        : Infinity;
      if (dt < 280 && dist < 24) {
        // For double-tap, prefer to use the tap location for zooming
        const c = centerZoom ? viewportCenter() : worldPoint(e.clientX, e.clientY);
        const target = s.current < doubleTapZoom ? doubleTapZoom : 1;
        setScaleAt(target, c);
      }
      onPointerDown._lastTap = { t: now, x: e.clientX, y: e.clientY };

      if (pointers.current.size === 2) {
        // begin pinch
        const [a, b] = [...pointers.current.values()];
        pinch.current = {
          s0: s.current,
          d0: Math.hypot(a.x - b.x, a.y - b.y),
          c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
        setTouchAction("none"); // disable scroll during active pinch
      } else if (s.current > 1 && pointers.current.size === 1) {
        pan.current = { x0: e.clientX, y0: e.clientY };
        setTouchAction("none");
  lastSample.current = { t: performance.now(), x: e.clientX, y: e.clientY };
  velocity.current = { vx: 0, vy: 0 };
      } else {
        setTouchAction("pan-y");
      }
    };

    const onPointerMove = (e) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size === 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.current.d0 > 0) {
          const factor = d / pinch.current.d0;
          // For pinch, always zoom at the midpoint of the two fingers rather than center
          // unless centerZoom is explicitly true
          const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const c = centerZoom ? viewportCenter() : worldPoint(midpoint.x, midpoint.y);
          setScaleAt(pinch.current.s0 * factor, c);
        }
        e.preventDefault();
      } else if (pointers.current.size === 1 && s.current > 1 && pan.current) {
        const dx = e.clientX - pan.current.x0;
        const dy = e.clientY - pan.current.y0;
        pan.current.x0 = e.clientX;
        pan.current.y0 = e.clientY;
        tx.current += dx;
        ty.current += dy;
        clampPan();
        requestPaint();
        // velocity sample
        const now = performance.now();
        const dt = now - lastSample.current.t;
        if (dt > 0) {
          const sx = e.clientX - lastSample.current.x;
          const sy = e.clientY - lastSample.current.y;
            velocity.current.vx = sx / dt; // px per ms
            velocity.current.vy = sy / dt;
            lastSample.current = { t: now, x: e.clientX, y: e.clientY };
        }
        e.preventDefault(); // pan the zoomed content; block scroll only while zoomed
      }
    };

    const endPanPinch = () => {
      if (pointers.current.size < 2) pinch.current = null;
      if (pointers.current.size === 0) {
        pan.current = null;
        if (s.current <= 1.01) {
          s.current = 1; tx.current = 0; ty.current = 0; requestPaint();
        }
    setTouchAction(s.current > 1 ? "none" : "pan-y");
    // notify listener that an interaction finished and the final scale is s.current
    try { onScaleEnd?.(s.current); } catch (e) { /* ignore */ }
        // launch inertia if zoomed & velocity above threshold
        if (momentum && s.current > 1 && (Math.hypot(velocity.current.vx, velocity.current.vy) > 0.02)) {
          const friction = 0.92; // per frame decay
          const maxMs = 1800;
          let lastT = performance.now();
          const startT = lastT;
          const step = () => {
            const now = performance.now();
            const dt = now - lastT; // ms
            lastT = now;
            // apply velocity
            tx.current += velocity.current.vx * dt;
            ty.current += velocity.current.vy * dt;
            const beforeX = tx.current, beforeY = ty.current;
            clampPan();
            // if clamped, dampen velocity strongly
            if (beforeX !== tx.current) velocity.current.vx *= 0.3;
            if (beforeY !== ty.current) velocity.current.vy *= 0.3;
            // decay velocity
            velocity.current.vx *= friction;
            velocity.current.vy *= friction;
            requestPaint();
            const speed = Math.hypot(velocity.current.vx, velocity.current.vy);
            if (speed > 0.005 && (now - startT) < maxMs) {
              inertiaRaf.current = requestAnimationFrame(step);
            } else {
              inertiaRaf.current = 0;
            }
          };
          inertiaRaf.current = requestAnimationFrame(step);
        }
      }
    };

    const onPointerUp = (e) => {
      pointers.current.delete(e.pointerId);
      endPanPinch();
    };

    const onPointerCancel = (e) => {
      pointers.current.delete(e.pointerId);
      endPanPinch();
    };

    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", onPointerUp, { passive: true });
    el.addEventListener("pointercancel", onPointerCancel, { passive: true });

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [clampPan, requestPaint]);

  // Wheel / trackpad pinch zoom (Ctrl/⌘ + wheel)
  useEffect(() => {
    if (!wheelZoom) return;
    const el = outerRef.current;
    if (!el) return;

    const onWheel = (e) => {
      // only zoom on ctrlKey/MetaKey (pinch gesture on many OS reports this)
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = -e.deltaY; // natural: up = zoom in
      const factor = Math.exp(delta * 0.0025); // smooth exponential scaling
      // For wheel zoom, prioritize the cursor position but use viewport center if centerZoom is true
      const c = centerZoom ? viewportCenter() : worldPoint(e.clientX, e.clientY);
      setScaleAt(s.current * factor, c);
      setTouchAction("none");
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Resize observer to keep bounds correct
  useLayoutEffect(() => {
    readRects();
    const ro = new ResizeObserver(() => {
      readRects();
      clampPan();
      requestPaint();
    });
    if (outerRef.current) ro.observe(outerRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    return () => ro.disconnect();
  }, [readRects, clampPan, requestPaint]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => () => { if (inertiaRaf.current) cancelAnimationFrame(inertiaRaf.current); }, []);

  return (
    <div
      ref={outerRef}
      className={"relative overflow-hidden touch-none select-none " + className}
      style={{ touchAction }}
    >
      <div
        ref={innerRef}
        className="will-change-transform origin-top-left"
        style={{ transform: `translate3d(${tx.current}px, ${ty.current}px, 0) scale(${s.current})` }}
      >
        {children}
      </div>
    </div>
  );
}
