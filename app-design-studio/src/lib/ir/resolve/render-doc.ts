/**
 * The ONE definition of "how a screen renders" outside the live canvas.
 * PhoneScreenRenderer, the resolve pass, and the visual test harness all
 * compose screens through these helpers, so what Playwright measures (and
 * what exports are proven against) is byte-identical to what the user sees.
 *
 * Moved here from PhoneScreenRenderer.tsx (which now imports these) so the
 * conventions can't fork.
 */

export const PHONE_SCREEN_PAGE_CLASS = "phone-screen-page";

/** Design-system CSS declares vars on :root; when scoped under the page we
 * remap them to :scope + .screen (both provenances used by app/website). */
export function adaptCssForScopedPhoneScreen(css: string): string {
  return (css || "").replace(/(^|[\s,{}])(:root)\b/g, "$1:scope, .screen");
}

export function scopedPhoneScreenCss(css: string): string {
  const normalized = `
:scope {
  display: block;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  font-size: 16px;
  /* Pin text-align so the screen never inherits it from the wrapper element.
     Lite renders inside a <button> (UA default text-align: center) while Pro
     renders inside a <div> (text-align: start); without this, identical
     screens diverge — centered in Lite, left in Pro. Design-system CSS and
     per-element styles can still override this. */
  text-align: left;
  /* Establish a containing block so position:fixed / width:100vw descendants
     (e.g. a bottom tab bar) are sized and clipped to the phone frame instead
     of escaping to the browser viewport. */
  transform: translateZ(0);
  contain: layout paint;
  color: var(--text, inherit);
  background: var(--bg, #000);
}
:scope, :scope * { box-sizing: border-box; }
`;

  return `@scope (.${PHONE_SCREEN_PAGE_CLASS}) to (.phone-screen-page-boundary) {\n${normalized}\n${adaptCssForScopedPhoneScreen(css)}\n}`;
}

export type ScreenDocOptions = {
  screenHtml: string;
  designSystemCss: string;
  frameWidth: number;
  frameHeight?: number;
  /** Websites size to content height; apps pin the phone frame height. */
  isWebsite: boolean;
};

/** Standalone document for one screen — same wrapper class, same scoped CSS,
 * same sibling-style injection as PhoneScreenRenderer. */
export function buildScreenDocument(opts: ScreenDocOptions): string {
  const heightRule =
    !opts.isWebsite && opts.frameHeight ? `height:${opts.frameHeight}px;overflow:hidden;` : "";
  return [
    "<!doctype html>",
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8">`,
    "<style>",
    `body{margin:0;background:#fff}` +
      `.${PHONE_SCREEN_PAGE_CLASS}{position:relative;width:${opts.frameWidth}px;${heightRule}}`,
    "</style>",
    "</head>",
    "<body>",
    `<div class="${PHONE_SCREEN_PAGE_CLASS}">`,
    opts.screenHtml,
    "</div>",
    `<style data-phone-screen-css="true">`,
    scopedPhoneScreenCss(opts.designSystemCss),
    "</style>",
    "</body>",
    "</html>",
  ].join("\n");
}
