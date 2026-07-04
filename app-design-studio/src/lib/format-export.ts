// Pretty-print exported code so downloads read like hand-written source
// (indentation, one declaration per line, spacing) instead of the minified,
// single-line HTML/CSS the clone/import pipeline stores internally.
//
// Prettier + its browser plugins are dynamically imported so they are
// code-split out of the main bundle and only fetched when someone exports.
// Every formatter falls back to the original string if Prettier throws, so a
// malformed or huge payload can never break the download.

const OPTS = { printWidth: 100, tabWidth: 2 } as const;

export async function prettyHtml(doc: string): Promise<string> {
  try {
    const [prettier, html, css] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/html"),
      import("prettier/plugins/postcss"),
    ]);
    return await prettier.format(doc, {
      parser: "html",
      plugins: [html.default ?? html, css.default ?? css],
      ...OPTS,
    });
  } catch {
    return doc;
  }
}

export async function prettyCss(css: string): Promise<string> {
  try {
    const [prettier, postcss] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/postcss"),
    ]);
    return await prettier.format(css, { parser: "css", plugins: [postcss.default ?? postcss], ...OPTS });
  } catch {
    return css;
  }
}

export async function prettyTsx(code: string): Promise<string> {
  try {
    const [prettier, ts, estree] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/typescript"),
      import("prettier/plugins/estree"),
    ]);
    return await prettier.format(code, {
      parser: "typescript",
      plugins: [ts.default ?? ts, estree.default ?? estree],
      ...OPTS,
    });
  } catch {
    return code;
  }
}
