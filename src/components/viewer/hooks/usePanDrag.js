import { useEffect, useRef } from "react";

export default function usePanDrag(scrollRef, { enabled, allowSpacePan = true } = {}) {
  const isSpacePanning = useRef(false);

  useEffect(() => {
    function onKeyDown(e) {
      if (!allowSpacePan) return;
      if (e.code === "Space") {
        isSpacePanning.current = true;
        e.preventDefault();
      }
    }
    function onKeyUp(e) {
      if (e.code === "Space") isSpacePanning.current = false;
    }
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [allowSpacePan]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let isDown = false, sx = 0, sy = 0, sl = 0, st = 0;

    const onMouseDown = (e) => {
      const allowPan = enabled || isSpacePanning.current;
      if (!allowPan || e.button !== 0) return;
      isDown = true;
      el.classList.add("cursor-grabbing");
      sx = e.clientX; sy = e.clientY; sl = el.scrollLeft; st = el.scrollTop;
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!isDown) return;
      el.scrollTo({ left: sl - (e.clientX - sx), top: st - (e.clientY - sy) });
    };
    const onMouseUp = () => {
      isDown = false;
      el.classList.remove("cursor-grabbing");
    };

    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [enabled, scrollRef]);
}
