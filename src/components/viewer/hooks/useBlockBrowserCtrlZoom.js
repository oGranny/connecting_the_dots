import { useEffect } from "react";

export default function useBlockBrowserCtrlZoom(scrollRef) {
  useEffect(() => {
    const el = scrollRef?.current;

    const inside = (ev) => {
      if (!el) return false;
      const path = ev.composedPath?.();
      return path ? path.includes(el) : el.contains(ev.target);
    };

    // Block Ctrl+Wheel (desktop) before the browser handles it
    const onWheelCapture = (e) => {
      if (e.ctrlKey && inside(e)) e.preventDefault();
    };

    // Block Ctrl/⌘ + (+ / - / 0) keyboard zoom when focus is in/over viewer
    const onKeyDownCapture = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (["+", "=", "-", "_", "0"].includes(k) || e.code.startsWith("Numpad")) {
        if (inside(e) || document.activeElement === document.body) e.preventDefault();
      }
    };

    // Safari pinch gestures
    const onGestureStart = (e) => { if (inside(e)) e.preventDefault(); };
    const onGestureChange = (e) => { if (inside(e)) e.preventDefault(); };
    const onGestureEnd = (e) => { if (inside(e)) e.preventDefault(); };

    window.addEventListener("wheel", onWheelCapture, { passive: false, capture: true });
    window.addEventListener("keydown", onKeyDownCapture, { passive: false, capture: true });
    window.addEventListener("gesturestart", onGestureStart, { passive: false, capture: true });
    window.addEventListener("gesturechange", onGestureChange, { passive: false, capture: true });
    window.addEventListener("gestureend", onGestureEnd, { passive: false, capture: true });

    return () => {
      window.removeEventListener("wheel", onWheelCapture, { capture: true });
      window.removeEventListener("keydown", onKeyDownCapture, { capture: true });
      window.removeEventListener("gesturestart", onGestureStart, { capture: true });
      window.removeEventListener("gesturechange", onGestureChange, { capture: true });
      window.removeEventListener("gestureend", onGestureEnd, { capture: true });
    };
  }, [scrollRef]);
}
