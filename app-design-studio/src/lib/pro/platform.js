export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

export const MOD = isMac ? "⌘" : "Ctrl";
export const ALT = isMac ? "⌥" : "Alt";
export const SHIFT = isMac ? "⇧" : "Shift";

// modifier check that treats ⌘ (mac) and Ctrl (win/linux) the same
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
