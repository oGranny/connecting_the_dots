import { useRef } from "react";

export default function useGrabScroll() {
  const state = useRef({ down: false, x: 0, y: 0, sl: 0, st: 0 });

  function onMouseDown(e) {
    const tag = e.target.tagName.toLowerCase();
    if (["input", "textarea", "button"].includes(tag)) return;

    const el = e.currentTarget;
    state.current = {
      down: true,
      x: e.clientX,
      y: e.clientY,
      sl: el.scrollLeft,
      st: el.scrollTop,
    };
    el.classList.add("cursor-grabbing");
    el.classList.remove("cursor-grab");
  }

  function onMouseMove(e) {
    if (!state.current.down) return;
    const el = e.currentTarget;
    el.scrollLeft = state.current.sl - (e.clientX - state.current.x);
    el.scrollTop = state.current.st - (e.clientY - state.current.y);
  }

  function end(e) {
    const el = e.currentTarget;
    state.current.down = false;
    el.classList.add("cursor-grab");
    el.classList.remove("cursor-grabbing");
  }

  return {
    onMouseDown,
    onMouseMove,
    onMouseUp: end,
    onMouseLeave: end,
    className: "cursor-grab select-none",
  };
}
