import { useEffect, useRef, useState } from "react";

export default function useDragResize({ initial, min = 180, max = 560, invert = false }) {
  const [width, setWidth] = useState(initial);
  const stateRef = useRef({ dragging: false, startX: 0, startWidth: initial });

  useEffect(() => {
    function onMove(e) {
      if (!stateRef.current.dragging) return;
      const dx = e.clientX - stateRef.current.startX;
      let w = stateRef.current.startWidth + (invert ? -dx : dx);
      if (w < min) w = min;
      if (w > max) w = max;
      setWidth(w);
    }
    function onUp() { stateRef.current.dragging = false; }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [min, max, invert]);

  function startDrag(e) {
    stateRef.current = { dragging: true, startX: e.clientX, startWidth: width };
  }

  return { width, startDrag };
}