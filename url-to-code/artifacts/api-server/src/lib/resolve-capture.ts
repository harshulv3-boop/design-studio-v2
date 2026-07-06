import { chromium, type Browser } from "playwright";

/**
 * Resolve pass: render a screen document (composed by the studio via its
 * shared render-doc module, so it is byte-identical to what the canvas shows)
 * and measure every [data-mae-id] element — geometry + a whitelisted computed
 * style subset. Consumed by design-target exporters (Figma, Flutter) that
 * need RESOLVED values instead of raw CSS.
 */

export type ResolveRequest = {
  documentHtml: string;
  viewport: { width: number; height: number };
  waitMs?: number;
};

export type ResolvedNode = {
  rect: { x: number; y: number; w: number; h: number };
  computed: Record<string, string>;
  imageNatural?: { w: number; h: number };
};

export type ResolveResult = {
  pageHeight: number;
  nodes: Record<string, ResolvedNode>;
  warnings: string[];
};

/** Computed properties design targets consume. Keep in sync with the studio's
 * resolve/types.ts whitelist documentation. */
const COMPUTED_WHITELIST = [
  "display",
  "position",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "align-self",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "gap",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration-line",
  "white-space",
  "color",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-top-style",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "box-shadow",
  "filter",
  "backdrop-filter",
  "opacity",
  "transform",
  "overflow-x",
  "overflow-y",
  "object-fit",
  "z-index",
];

export async function resolveDocument(request: ResolveRequest): Promise<ResolveResult> {
  const waitMs = Math.min(Math.max(request.waitMs ?? 8000, 0), 20000);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: {
        width: Math.min(Math.max(request.viewport.width, 200), 4000),
        height: Math.min(Math.max(request.viewport.height, 200), 4000),
      },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.setContent(request.documentHtml, { waitUntil: "networkidle", timeout: waitMs });

    // Fonts and images change metrics — wait for both (bounded).
    await page
      .evaluate(
        (timeout) =>
          Promise.race([
            Promise.all([
              document.fonts.ready,
              ...Array.from(document.images)
                .filter((img) => !img.complete)
                .map(
                  (img) =>
                    new Promise((resolve) => {
                      img.addEventListener("load", resolve, { once: true });
                      img.addEventListener("error", resolve, { once: true });
                    }),
                ),
            ]),
            new Promise((resolve) => setTimeout(resolve, timeout)),
          ]),
        waitMs,
      )
      .catch(() => undefined);

    const result = await page.evaluate((whitelist: string[]) => {
      const warnings: string[] = [];
      const root =
        document.querySelector(".phone-screen-page") || document.body.firstElementChild || document.body;
      const rootRect = root.getBoundingClientRect();
      const nodes: Record<
        string,
        {
          rect: { x: number; y: number; w: number; h: number };
          computed: Record<string, string>;
          imageNatural?: { w: number; h: number };
        }
      > = {};

      document.querySelectorAll("[data-mae-id]").forEach((el) => {
        const id = el.getAttribute("data-mae-id");
        if (!id) return;
        if (nodes[id]) {
          warnings.push(`Duplicate data-mae-id "${id}" — kept the first.`);
          return;
        }
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const computed: Record<string, string> = {};
        for (const prop of whitelist) {
          computed[prop] = style.getPropertyValue(prop);
        }
        const entry: (typeof nodes)[string] = {
          rect: {
            x: rect.left - rootRect.left,
            y: rect.top - rootRect.top,
            w: rect.width,
            h: rect.height,
          },
          computed,
        };
        if (el instanceof HTMLImageElement && el.naturalWidth) {
          entry.imageNatural = { w: el.naturalWidth, h: el.naturalHeight };
        }
        nodes[id] = entry;
      });

      return {
        pageHeight: Math.max(root.scrollHeight, Math.round(rootRect.height)),
        nodes,
        warnings,
      };
    }, COMPUTED_WHITELIST);

    return result;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
