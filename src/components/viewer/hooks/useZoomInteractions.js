// src/components/viewer/hooks/useZoomInteractions.js
import { useEffect } from "react";
import { clamp } from "../utils/geometry";

export default function useZoomInteractions(scrollRef, setZoom, opts = {}) {
  const min = opts.min ?? 0.25;
  const max = opts.max ?? 4;
  const sensitivity = opts.sensitivity ?? 0.0025;

  // ---- Ctrl+Wheel (incl. pinch on Chrome/Edge desktop)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e) => {
      // Only zoom when Ctrl is pressed. Chrome/Edge set ctrlKey=true for trackpad pinch.
      if (!e.ctrlKey) return;
      e.preventDefault();

      const delta = -e.deltaY; // up=in, down=out
      const scale = Math.exp(delta * sensitivity);

      const rect = el.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      setZoom((z) => {
        const newZ = clamp(z * scale, min, max);
        const s = newZ / z;

        // keep pointer position stable during zoom
        el.scrollLeft = (el.scrollLeft + offsetX) * s - offsetX;
        el.scrollTop  = (el.scrollTop  + offsetY) * s - offsetY;

        return newZ;
      });
    };

    // passive:false is required to call preventDefault on wheel
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scrollRef, min, max, sensitivity, setZoom]);

  // ---- Touch pinch (mobile/tablet) using two-finger distance
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let pinch = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches;
        pinch = {
          last: dist(a, b),
          cx: (a.clientX + b.clientX) / 2,
          cy: (a.clientY + b.clientY) / 2,
        };
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && pinch) {
        // prevent page from scrolling/zooming
        e.preventDefault();

        const [a, b] = e.touches;
        const d = dist(a, b);
        if (!d || !pinch.last) return;

        const scale = d / pinch.last;
        pinch.last = d;

        const rect = el.getBoundingClientRect();
        const offsetX = pinch.cx - rect.left;
        const offsetY = pinch.cy - rect.top;

        setZoom((z) => {
          const newZ = clamp(z * scale, min, max);
          const s = newZ / z;
          el.scrollLeft = (el.scrollLeft + offsetX) * s - offsetX;
          el.scrollTop  = (el.scrollTop  + offsetY) * s - offsetY;
          return newZ;
        });
      }
    };

    const onTouchEnd = () => { pinch = null; };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [scrollRef, min, max, setZoom]);

  // ---- Safari: gesturestart/gesturechange (pinch) support
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let lastScale = 1;
    let center = null;

    const onGestureStart = (e) => {
      // Block Safari's default page zoom
      e.preventDefault();
      lastScale = e.scale || 1;

      const rect = el.getBoundingClientRect();
      const cx = (e.clientX ?? rect.left + rect.width / 2);
      const cy = (e.clientY ?? rect.top + rect.height / 2);
      center = { x: cx, y: cy };
    };
    const onGestureChange = (e) => {
      e.preventDefault();
      const scale = (e.scale || 1) / (lastScale || 1);
      lastScale = e.scale || 1;

      const rect = el.getBoundingClientRect();
      const offsetX = (center?.x ?? rect.left + rect.width / 2) - rect.left;
      const offsetY = (center?.y ?? rect.top + rect.height / 2) - rect.top;

      setZoom((z) => {
        const newZ = clamp(z * scale, min, max);
        const s = newZ / z;
        el.scrollLeft = (el.scrollLeft + offsetX) * s - offsetX;
        el.scrollTop  = (el.scrollTop  + offsetY) * s - offsetY;
        return newZ;
      });
    };
    const onGestureEnd = (e) => {
      e.preventDefault();
      lastScale = 1;
      center = null;
    };

    // Only Safari fires these; other browsers ignore them harmlessly.
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    el.addEventListener("gestureend", onGestureEnd, { passive: false });

    return () => {
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, [scrollRef, min, max, setZoom]);
}
