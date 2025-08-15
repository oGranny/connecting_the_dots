export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const thresholds = () => Array.from({ length: 21 }, (_, i) => i / 20);
