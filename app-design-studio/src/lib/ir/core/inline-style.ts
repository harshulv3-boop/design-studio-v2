import type { StyleDecl } from "../schema";

/**
 * Lossless inline-style parsing/serialization.
 *
 * The browser's CSSStyleDeclaration is deliberately NOT used: it reorders,
 * normalizes and silently drops unknown/invalid properties, all of which
 * violate the zero-drift standard. This tokenizer preserves declaration
 * order, property case, unknown properties, custom properties (--x) and
 * !important, and splits safely across quotes and nested parens — the classic
 * trap being `url(data:image/svg+xml;base64,...)` which contains `;` and `:`.
 */

export function parseInlineStyle(style: string | null | undefined): StyleDecl[] {
  if (!style) return [];
  const decls: StyleDecl[] = [];
  for (const chunk of splitTop(style, ";")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const colon = topLevelIndexOf(trimmed, ":");
    if (colon <= 0) continue; // no property name — not a declaration
    const prop = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    let important = false;
    const m = /![ \t]*important[ \t]*$/i.exec(value);
    if (m) {
      important = true;
      value = value.slice(0, m.index).trim();
    }
    if (!prop) continue;
    decls.push([prop, value, important]);
  }
  return decls;
}

export function serializeInlineStyle(decls: StyleDecl[]): string {
  return decls
    .map(([prop, value, important]) => `${prop}: ${value}${important ? " !important" : ""}`)
    .join("; ");
}

/** Last-wins lookup, mirroring the cascade within a single style attribute. */
export function getDecl(decls: StyleDecl[], prop: string): string | undefined {
  const target = prop.toLowerCase();
  for (let i = decls.length - 1; i >= 0; i--) {
    if (decls[i][0].toLowerCase() === target) return decls[i][1];
  }
  return undefined;
}

/** Split on `sep` only at depth 0 (outside quotes and parens). */
export function splitTop(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      current += ch;
      if (ch === quote && input[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

function topLevelIndexOf(input: string, ch: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote && input[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}
