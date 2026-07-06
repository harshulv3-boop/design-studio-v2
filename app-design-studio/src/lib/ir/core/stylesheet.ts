import type { IRStylesheet } from "../schema";

/**
 * designSystemCss handling. The raw string is ground truth and is what every
 * code exporter emits verbatim — parsing here is ADVISORY only (variables,
 * fonts) for narrow targets and UI, via css-tree, which is tolerant and never
 * gates the pipeline: anything unparseable simply yields fewer advisory facts.
 *
 * Note css-tree over postcss (lighter, no transform pipeline needed) and over
 * browser CSSStyleSheet (which silently drops unknown/invalid declarations —
 * a losslessness violation).
 */

export async function parseStylesheet(raw: string): Promise<IRStylesheet> {
  const sheet: IRStylesheet = { raw: raw || "", variables: {}, fonts: [] };
  if (!raw) return sheet;

  try {
    const csstree = await import("css-tree");
    const ast = csstree.parse(raw, { positions: false, parseValue: false });

    csstree.walk(ast, {
      visit: "Rule",
      enter(rule) {
        if (rule.prelude.type !== "SelectorList") return;
        const selector = csstree.generate(rule.prelude);
        // Variables come from :root (design system) and .screen (clone
        // engine's rewrite target) — both provenances are understood.
        const isVarScope = /(^|,)\s*(:root|\.screen)\s*($|,)/.test(selector);
        rule.block.children.forEach((decl) => {
          if (decl.type !== "Declaration") return;
          if (isVarScope && decl.property.startsWith("--")) {
            sheet.variables[decl.property] = csstree.generate(decl.value).trim();
          }
        });
      },
    });

    csstree.walk(ast, {
      visit: "Atrule",
      enter(atrule) {
        if (atrule.name !== "font-face" || !atrule.block) return;
        let family = "";
        let weight = "";
        let src = "";
        atrule.block.children.forEach((decl) => {
          if (decl.type !== "Declaration") return;
          const value = csstree
            .generate(decl.value)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          if (decl.property === "font-family") family = value;
          else if (decl.property === "font-weight") weight = value;
          else if (decl.property === "src") src = value;
        });
        if (!family) return;
        const existing = sheet.fonts.find((f) => f.family === family);
        if (existing) {
          if (weight && !existing.weights.includes(weight)) existing.weights.push(weight);
        } else {
          sheet.fonts.push({ family, weights: weight ? [weight] : [], src: src || undefined });
        }
      },
    });
  } catch {
    // Advisory parse only — raw remains authoritative.
  }
  return sheet;
}
