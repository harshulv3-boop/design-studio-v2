// App-wide light/dark theme for the editor chrome.
// Applies `theme-light` / `theme-dark` on <html>; CSS overrides live in index.css.
const KEY = "mae-theme";

export function getTheme() {
  return localStorage.getItem(KEY) || "dark";
}

export function applyTheme(theme) {
  const el = document.documentElement;
  el.classList.remove("theme-light", "theme-dark");
  el.classList.add(theme === "light" ? "theme-light" : "theme-dark");
  localStorage.setItem(KEY, theme);
}

export function toggleTheme() {
  const next = getTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}
