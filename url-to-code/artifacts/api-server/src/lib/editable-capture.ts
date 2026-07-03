/**
 * Editable-artifact capture — produces the JS-free, canvas-ready version of a
 * cloned page for App Design Studio's editor ("Edit Design" path).
 *
 * Runs INSIDE the live Playwright page (string-form evaluate, per repo gotcha:
 * server tsconfig has no DOM types) at the end of the normal clone job, when
 * the DOM is settled: post-JS, post-auto-scroll.
 *
 * Fidelity strategy (fidelity > size, then aggressive size reduction):
 *  - CSS re-parsed via a constructed CSSStyleSheet (inert), then @media kept
 *    only if it matches the 1440px capture viewport, style rules tree-shaken
 *    to those whose selector matches the DOM, @keyframes dropped, motion
 *    frozen, html/body/:root rewritten to .screen.
 *  - DOM: deep clone of <body> with per-instance state transferred (img
 *    currentSrc, canvas->img snapshot, iframe/form->div, input values).
 *  - Multi-page (v2): per-page by design; a crawl loop calls it once per page.
 */

export interface EditablePage {
  sourceUrl: string;
  title: string;
  frameWidth: number;
  pageHeight: number;
  html: string;
  css: string;
  warnings: string[];
}

/** Absolutize url(...) refs against the sheet's own URL. */
export function absolutizeCssUrls(cssText: string, baseUrl: string): string {
  return cssText.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
    (full, _quote: string, ref: string) => {
      const r = ref.trim();
      if (
        r.startsWith("data:") ||
        r.startsWith("blob:") ||
        r.startsWith("#") ||
        r.startsWith("http://") ||
        r.startsWith("https://")
      ) {
        return full;
      }
      try {
        return 'url("' + new URL(r, baseUrl).href + '")';
      } catch {
        return full;
      }
    },
  );
}

/** Inline @import statements from the captured set; drop uncaptured ones. */
export function inlineCssImports(
  cssText: string,
  baseUrl: string,
  byUrl: Map<string, string>,
  depth = 0,
): string {
  if (depth > 4) return cssText;
  return cssText.replace(
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/g,
    (_full, _q1, ref1: string, _q2, ref2: string, media: string) => {
      const ref = (ref1 || ref2 || "").trim();
      let absUrl: string;
      try {
        absUrl = new URL(ref, baseUrl).href;
      } catch {
        return "";
      }
      const imported = byUrl.get(absUrl);
      if (imported == null) return "";
      const inlined = inlineCssImports(
        absolutizeCssUrls(imported, absUrl),
        absUrl,
        byUrl,
        depth + 1,
      );
      const cond = (media || "").trim();
      return cond ? "@media " + cond + " {\n" + inlined + "\n}" : inlined;
    },
  );
}

/** Conservative CSS minifier: strips comments + collapses whitespace, never
 *  touching content inside quoted strings. */
export function minifyCss(css: string): string {
  let out = "";
  let i = 0;
  const n = css.length;
  let inStr: string | null = null;
  let lastWasSpace = false;
  while (i < n) {
    const c = css[i]!;
    if (inStr) {
      out += c;
      if (c === "\\") {
        if (i + 1 < n) {
          out += css[i + 1];
          i += 2;
          continue;
        }
      } else if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      out += c;
      lastWasSpace = false;
      i++;
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "\n" || c === "\t" || c === "\r" || c === " ") {
      if (!lastWasSpace) {
        out += " ";
        lastWasSpace = true;
      }
      i++;
      continue;
    }
    if ("{}:;,>".includes(c)) {
      if (lastWasSpace && out.endsWith(" ")) out = out.slice(0, -1);
      out += c;
      lastWasSpace = true;
      i++;
      continue;
    }
    out += c;
    lastWasSpace = false;
    i++;
  }
  return out.trim();
}

/**
 * The in-page capture script (string form, evaluated in the browser context).
 * CSS texts are already absolutized + @import-inlined in Node.
 */
export const EDITABLE_CAPTURE_SCRIPT = String.raw`
(async ({ cssSources, pageUrl }) => {
  const warnings = [];
  const abs = (ref, base) => { try { return new URL(ref, base || pageUrl).href; } catch { return ref; } };

  // @import is illegal in a constructed sheet; Node already inlined captured
  // imports — strip any stray ones so one can't drop a whole inline sheet.
  const parseSheet = (text) => {
    const cleaned = (text || "").replace(/@import[^;]+;/g, "");
    try { const s = new CSSStyleSheet(); s.replaceSync(cleaned); return s; }
    catch (e) { warnings.push("sheet parse failed: " + e.message); return null; }
  };

  const PSEUDO_RE = /::?[a-zA-Z-]+(\([^)]*\))?/g;
  const selectorMatches = (sel) => {
    const s = sel.trim();
    if (!s) return false;
    if (/^(:root|html|body)\b/i.test(s)) return true;
    if (s === "*" || s.startsWith("*")) return true;
    const stripped = s.replace(PSEUDO_RE, (m) => /^:(not|is|where|has)\(/i.test(m) ? m : "")
      .trim().replace(/\s*([>+~])\s*$/, "");
    if (!stripped) return true;
    try { return document.querySelector(stripped) != null; }
    catch { return true; }
  };

  const keepRuleText = [];
  let shaken = 0, kept = 0;

  const walkRules = (rules) => {
    for (const rule of rules) {
      const t = rule.constructor.name;
      if (t === "CSSMediaRule") {
        const cond = rule.conditionText || rule.media.mediaText;
        if (window.matchMedia(cond).matches) walkRules(rule.cssRules);
        continue;
      }
      if (t === "CSSSupportsRule") {
        let ok = true;
        try { ok = CSS.supports(rule.conditionText); } catch { ok = true; }
        if (ok) walkRules(rule.cssRules);
        continue;
      }
      if (t === "CSSKeyframesRule") continue;
      if (t === "CSSImportRule") continue;
      if (t === "CSSFontFaceRule") { keepRuleText.push(rule.cssText); kept++; continue; }
      if (t === "CSSStyleRule") {
        const selList = rule.selectorText.split(",");
        const alive = selList.filter(selectorMatches);
        if (alive.length === 0) { shaken++; continue; }
        const rewritten = alive.map((s) =>
          s.replace(/(^|[^\w-])(:root|html|body)(?![\w-])/gi, "$1.screen")
        ).join(",");
        const body = rule.cssText.slice(rule.cssText.indexOf("{"));
        keepRuleText.push(rewritten + body);
        kept++;
        continue;
      }
      if (rule.cssRules && rule.cssRules.length) { walkRules(rule.cssRules); continue; }
      keepRuleText.push(rule.cssText); kept++;
    }
  };

  for (const src of cssSources) {
    const sheet = parseSheet(src.text);
    if (sheet) walkRules(sheet.cssRules);
  }
  for (const styleEl of document.querySelectorAll("style")) {
    const sheet = parseSheet(styleEl.textContent || "");
    if (sheet) walkRules(sheet.cssRules);
  }
  for (const adopted of (document.adoptedStyleSheets || [])) {
    try { walkRules(adopted.cssRules); } catch { warnings.push("adopted sheet unreadable"); }
  }

  keepRuleText.push("*,*::before,*::after{animation:none!important;transition:none!important}");

  let shadowHosts = 0;
  for (const el of document.body.querySelectorAll("*")) if (el.shadowRoot) shadowHosts++;
  if (shadowHosts) warnings.push(shadowHosts + " shadow-DOM host(s) not flattened (v2)");

  const cloneRoot = document.body.cloneNode(true);
  const orig = [document.body, ...document.body.querySelectorAll("*")];
  const copy = [cloneRoot, ...cloneRoot.querySelectorAll("*")];
  const replacements = [];

  for (let i = 0; i < orig.length; i++) {
    const o = orig[i], c = copy[i];
    if (!c) break;
    const tag = o.tagName;

    if (tag === "IMG") {
      const src = o.currentSrc || o.src;
      if (src) c.setAttribute("src", abs(src));
      c.removeAttribute("srcset"); c.removeAttribute("sizes");
      c.removeAttribute("loading"); c.removeAttribute("decoding");
      if (!c.getAttribute("width") && o.width) c.setAttribute("width", String(o.width));
      if (!c.getAttribute("height") && o.height) c.setAttribute("height", String(o.height));
    } else if (tag === "SOURCE") {
      replacements.push([c, null]);
    } else if (tag === "CANVAS") {
      let snap = null;
      try { snap = o.toDataURL("image/png"); } catch { warnings.push("tainted canvas skipped"); }
      const img = document.createElement("img");
      for (const a of c.attributes) img.setAttribute(a.name, a.value);
      const r = o.getBoundingClientRect();
      if (snap) img.setAttribute("src", snap);
      img.setAttribute("width", String(Math.round(r.width)));
      img.setAttribute("height", String(Math.round(r.height)));
      replacements.push([c, img]);
    } else if (tag === "IFRAME" || tag === "EMBED" || tag === "OBJECT") {
      const div = document.createElement("div");
      for (const a of c.attributes) if (a.name !== "src" && a.name !== "srcdoc") div.setAttribute(a.name, a.value);
      const r = o.getBoundingClientRect();
      div.setAttribute("data-orig-tag", tag.toLowerCase());
      const prev = div.getAttribute("style") || "";
      div.setAttribute("style", prev + ";width:" + Math.round(r.width) + "px;height:" + Math.round(r.height) + "px;background:#f3f4f6;");
      replacements.push([c, div]);
    } else if (tag === "FORM") {
      const div = document.createElement("div");
      for (const a of c.attributes) if (!/^(action|method|target|novalidate)$/i.test(a.name)) div.setAttribute(a.name, a.value);
      div.setAttribute("data-orig-tag", "form");
      while (c.firstChild) div.appendChild(c.firstChild);
      replacements.push([c, div]);
    } else if (tag === "INPUT") {
      if (o.type === "checkbox" || o.type === "radio") {
        if (o.checked) c.setAttribute("checked", ""); else c.removeAttribute("checked");
      } else if (o.value) c.setAttribute("value", o.value);
    } else if (tag === "TEXTAREA") {
      c.textContent = o.value;
    } else if (tag === "SELECT") {
      const oOpts = o.querySelectorAll("option"), cOpts = c.querySelectorAll("option");
      oOpts.forEach((op, k) => { if (cOpts[k]) { if (op.selected) cOpts[k].setAttribute("selected", ""); else cOpts[k].removeAttribute("selected"); } });
    } else if (tag === "VIDEO") {
      const src = o.currentSrc || o.src;
      if (src) c.setAttribute("src", abs(src));
      if (o.poster) c.setAttribute("poster", abs(o.poster));
      c.removeAttribute("autoplay");
    } else if (tag === "A") {
      const href = c.getAttribute("href");
      if (href && !href.startsWith("#")) c.setAttribute("href", abs(href));
    }

    const st = c.getAttribute && c.getAttribute("style");
    if (st && st.includes("url(")) {
      c.setAttribute("style", st.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (f, q, ref) => {
        const r = ref.trim();
        if (r.startsWith("data:") || r.startsWith("http") || r.startsWith("#")) return f;
        return 'url("' + abs(r) + '")';
      }));
    }
  }
  for (const [node, repl] of replacements) {
    if (repl) node.replaceWith(repl); else node.remove();
  }

  cloneRoot.querySelectorAll("script,noscript,template,style,link").forEach((n) => n.remove());
  const tw = document.createTreeWalker(cloneRoot, NodeFilter.SHOW_COMMENT);
  const comments = []; while (tw.nextNode()) comments.push(tw.currentNode);
  comments.forEach((n) => n.remove());

  const bodyCs = getComputedStyle(document.body);
  // line-height must stay a UNITLESS ratio: getComputedStyle returns it as an
  // absolute px (e.g. "24px"), and inheriting an absolute px into larger text
  // (e.g. a 46px heading) clips it to the body's line box. Convert back to a
  // ratio so descendants scale it against their own font-size, exactly as the
  // original unitless "line-height:1.5" did. ("normal" is left as-is.)
  let rootLh = bodyCs.lineHeight;
  if (rootLh && rootLh.endsWith("px")) {
    const fsz = parseFloat(bodyCs.fontSize) || 16;
    const ratio = parseFloat(rootLh) / fsz;
    if (ratio > 0) rootLh = ratio.toFixed(4);
  }
  const rootExtras =
    ".screen{background:" + bodyCs.backgroundColor + ";" +
    (bodyCs.backgroundImage !== "none" ? "background-image:" + bodyCs.backgroundImage + ";" : "") +
    "color:" + bodyCs.color + ";font-family:" + bodyCs.fontFamily + ";" +
    "font-size:" + bodyCs.fontSize + ";line-height:" + rootLh + ";overflow:visible;height:auto;min-height:0}";
  keepRuleText.push(rootExtras);

  return {
    html: cloneRoot.innerHTML,
    css: keepRuleText.join("\n"),
    title: document.title || location.hostname,
    pageHeight: Math.round(document.documentElement.scrollHeight),
    stats: { kept, shaken },
    warnings,
  };
})
`;
