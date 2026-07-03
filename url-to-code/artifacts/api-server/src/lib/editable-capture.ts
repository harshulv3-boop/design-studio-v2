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

  // Freeze animations/transitions on the LIVE page before reading any computed
  // styles. The exported artifact freezes motion the same way, so measuring the
  // page in its frozen state is what makes the per-element snapshots accurate.
  // Crucially, it exposes scroll-reveal elements: a fade-in whose end state
  // (opacity:1) is only held by animation-fill-mode reverts to its base
  // opacity:0 once animation is off — which is exactly what the clone will show,
  // and what the opacity-reveal fix below then corrects.
  const freezeStyle = document.createElement("style");
  freezeStyle.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}";
  document.documentElement.appendChild(freezeStyle);
  void document.body.offsetHeight; // force reflow so computed styles update

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
        const touchesRoot = /(^|[^\w-])(:root|html|body)(?![\w-])/i.test(rule.selectorText);
        let body;
        if (touchesRoot) {
          // Root-scoped rules can carry transient scroll-lock / full-height
          // state (e.g. a page that was showing a modal or locale overlay sets
          // html{overflow:hidden;height:100%}). Once html/body becomes the
          // .screen wrapper, those props collapse or clip the whole captured
          // page — the classic "page renders as an empty black box" bug. Strip
          // the flow-controlling props here so the wrapper flows naturally; the
          // normalization rule (rootExtras, pushed last) sets the safe values.
          for (const p of ["overflow", "overflow-x", "overflow-y", "height", "min-height", "max-height"]) {
            try { rule.style.removeProperty(p); } catch (e) { /* ignore */ }
          }
          body = rule.style.cssText ? "{" + rule.style.cssText + "}" : "";
          if (!body) { shaken++; continue; }
        } else {
          body = rule.cssText.slice(rule.cssText.indexOf("{"));
        }
        const rewritten = alive.map((s) =>
          s.replace(/(^|[^\w-])(:root|html|body)(?![\w-])/gi, "$1.screen")
        ).join(",");
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

  // ---- Shadow-DOM flattening -------------------------------------------
  // cloneNode(true) does NOT copy shadow roots, so component-based sites
  // (Web Components — e.g. Microsoft's nav) would lose all their shadow
  // content and scoped styles. Build the clone recursively instead: wherever
  // a host has a shadowRoot, inline its rendered shadow tree (resolving
  // <slot>s to their assigned light-DOM nodes) and collect the shadow's
  // scoped stylesheets, re-scoped to that host via a data-sd-scope attribute.
  let sdScopeCounter = 0;
  const shadowSheets = []; // { id, text }

  const collectShadowStyles = (root, id) => {
    for (const st of root.querySelectorAll("style")) {
      shadowSheets.push({ id: id, text: st.textContent || "" });
    }
    for (const sheet of (root.adoptedStyleSheets || [])) {
      try {
        let t = "";
        for (const r of sheet.cssRules) t += r.cssText + "\n";
        shadowSheets.push({ id: id, text: t });
      } catch (e) { warnings.push("shadow adopted sheet unreadable"); }
    }
  };

  // [ [liveEl, cloneEl], ... ] in document order — drives the transform pass.
  const cloneMap = [];

  // inShadow: when cloning a shadow tree, <slot> is resolved to assigned nodes.
  const buildClone = (live, inShadow) => {
    const nt = live.nodeType;
    if (nt === 3) return document.createTextNode(live.nodeValue); // text
    if (nt !== 1) return null;                                    // skip comments etc.

    if (inShadow && live.tagName === "SLOT") {
      const frag = document.createDocumentFragment();
      let assigned = [];
      try { assigned = live.assignedNodes({ flatten: true }) || []; } catch (e) { assigned = []; }
      const srcNodes = assigned.length ? assigned : Array.prototype.slice.call(live.childNodes);
      for (const a of srcNodes) {
        // Slotted light-DOM nodes are styled by the OUTER tree (inShadow=false);
        // slot fallback content stays in the shadow styling context.
        const cc = buildClone(a, assigned.length ? false : inShadow);
        if (cc) frag.appendChild(cc);
      }
      return frag;
    }

    const c = live.cloneNode(false);
    if (c.nodeType === 1) cloneMap.push([live, c]);

    const sr = live.shadowRoot;
    if (sr) {
      const id = ++sdScopeCounter;
      c.setAttribute("data-sd-scope", String(id));
      collectShadowStyles(sr, id);
      for (const child of sr.childNodes) {
        const cc = buildClone(child, true);
        if (cc) c.appendChild(cc);
      }
    } else {
      for (const child of live.childNodes) {
        const cc = buildClone(child, inShadow);
        if (cc) c.appendChild(cc);
      }
    }
    return c;
  };

  const cloneRoot = buildClone(document.body, false);

  // Scope + emit shadow stylesheets. querySelector-based tree-shaking can't see
  // shadow content, so these are kept whole (component sheets are small).
  const scopeSelectorText = (selText, id) => {
    const scope = '[data-sd-scope="' + id + '"]';
    return selText.split(",").map((s) => {
      s = s.trim();
      if (!s) return s;
      s = s.replace(/:host-context\([^)]*\)/g, scope);
      s = s.replace(/:host\(([^)]*)\)/g, scope + "$1");
      s = s.replace(/::slotted\(([^)]*)\)/g, scope + " $1");
      s = s.replace(/:host\b/g, scope);
      if (s.indexOf(scope) === 0) return s;
      return scope + " " + s;
    }).join(",");
  };
  const walkShadowRules = (rules, id) => {
    for (const rule of rules) {
      const t = rule.constructor.name;
      if (t === "CSSMediaRule") {
        const cond = rule.conditionText || rule.media.mediaText;
        if (window.matchMedia(cond).matches) walkShadowRules(rule.cssRules, id);
        continue;
      }
      if (t === "CSSSupportsRule") {
        let ok = true; try { ok = CSS.supports(rule.conditionText); } catch (e) { ok = true; }
        if (ok) walkShadowRules(rule.cssRules, id);
        continue;
      }
      if (t === "CSSKeyframesRule" || t === "CSSImportRule") continue;
      if (t === "CSSFontFaceRule") { keepRuleText.push(rule.cssText); kept++; continue; }
      if (t === "CSSStyleRule") {
        const body = rule.cssText.slice(rule.cssText.indexOf("{"));
        keepRuleText.push(scopeSelectorText(rule.selectorText, id) + body);
        kept++; continue;
      }
      if (rule.cssRules && rule.cssRules.length) { walkShadowRules(rule.cssRules, id); continue; }
      keepRuleText.push(rule.cssText); kept++;
    }
  };
  for (const sh of shadowSheets) {
    const sheet = parseSheet(sh.text);
    if (sheet) walkShadowRules(sheet.cssRules, sh.id);
  }
  if (sdScopeCounter) warnings.push(sdScopeCounter + " shadow-DOM host(s) flattened");

  const replacements = [];

  for (let i = 0; i < cloneMap.length; i++) {
    const o = cloneMap[i][0], c = cloneMap[i][1];
    if (!o || !c) continue;
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

    // Freeze the computed display at the 1440-px capture viewport.
    // The CSS tree-shaker unwraps @media rules and drops @layer wrappers,
    // which can corrupt cascade order: a mobile-first display:none default
    // may land AFTER the unwrapped desktop display:flex override, causing
    // the wrong rule to win. Inlining the computed value beats every
    // stylesheet rule (specificity [1,0,0,0]), locking in the desktop layout.
    // We skip HTML-default values (block, inline, etc.) to keep payload small.
    {
      const cs = window.getComputedStyle(o);
      const disp = cs.display;
      const SAFE = "block inline inline-block list-item table table-row table-cell table-row-group table-column table-column-group table-header-group table-footer-group table-caption ruby ruby-text";
      if (SAFE.indexOf(disp) === -1) {
        const prev = c.getAttribute("style") || "";
        c.setAttribute("style", prev + (prev ? ";" : "") + "display:" + disp);
      }

      // Scroll-reveal fix. Fade-in-on-scroll elements start at opacity:0 and are
      // revealed by JS (IntersectionObserver toggling a class) or by an
      // animation that ends at opacity:1. With JS stripped and animations
      // frozen, they stay invisible — a very common cause of whole sections /
      // nav rows / cards silently missing on modern sites (Apple, etc.). Force
      // them visible when they carry real content and sit in normal flow
      // (static/relative). Absolutely/fixed-positioned opacity:0 nodes are left
      // alone: those are usually legitimate overlays (dropdowns, tooltips,
      // stacked carousel slides) that should stay hidden.
      if (cs.opacity === "0" && disp !== "none" && (cs.position === "static" || cs.position === "relative")) {
        const rect = o.getBoundingClientRect();
        const hasContent = (o.textContent && o.textContent.trim().length > 0) ||
          o.querySelector("img,svg,picture,video,canvas");
        if (rect.width > 1 && rect.height > 1 && hasContent) {
          const prev = c.getAttribute("style") || "";
          c.setAttribute("style", prev + (prev ? ";" : "") + "opacity:1");
        }
      }
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
    "font-size:" + bodyCs.fontSize + ";line-height:" + rootLh + ";" +
    // !important + last position guarantees the wrapper flows and is never
    // clipped, even if a surviving root rule has higher specificity (html.foo).
    "overflow:visible!important;height:auto!important;min-height:0!important;max-height:none!important}";
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
