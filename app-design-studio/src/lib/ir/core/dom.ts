/**
 * Isomorphic DOM access for the IR pipeline.
 *
 * Browser + vitest/jsdom: native DOMParser/document. Server routes (Figma
 * import, code import) run under Node where TanStack Start has no DOM; there
 * we lazily fall back to linkedom. All IR traversal code is written against
 * the standard DOM interface only, so the backend is interchangeable.
 */

type DomBackend = {
  parseFragment(html: string): Element;
  createDocument(): Document;
};

let backend: DomBackend | null = null;

function browserBackend(): DomBackend {
  return {
    parseFragment(html: string): Element {
      const doc = new DOMParser().parseFromString(`<div id="__ir_root">${html}</div>`, "text/html");
      const root = doc.getElementById("__ir_root");
      if (!root) throw new Error("IR: failed to parse HTML fragment");
      return root;
    },
    createDocument(): Document {
      return document.implementation.createHTMLDocument("ir");
    },
  };
}

async function nodeBackend(): Promise<DomBackend> {
  const { parseHTML } = await import("linkedom");
  return {
    parseFragment(html: string): Element {
      const { document } = parseHTML(`<html><body><div id="__ir_root">${html}</div></body></html>`);
      const root = document.getElementById("__ir_root");
      if (!root) throw new Error("IR: failed to parse HTML fragment");
      return root as unknown as Element;
    },
    createDocument(): Document {
      const { document } = parseHTML("<html><body></body></html>");
      return document as unknown as Document;
    },
  };
}

export async function getDom(): Promise<DomBackend> {
  if (backend) return backend;
  backend =
    typeof DOMParser !== "undefined" && typeof document !== "undefined"
      ? browserBackend()
      : await nodeBackend();
  return backend;
}
