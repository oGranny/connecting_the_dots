// Shared small utilities

export const cls = (...xs) => xs.filter(Boolean).join(" ");

export const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
