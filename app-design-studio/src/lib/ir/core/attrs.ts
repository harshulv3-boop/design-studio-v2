import type { IRNode } from "../schema";
import { getDecl } from "./inline-style";

/**
 * Typed, DERIVED accessors over the editor's data-* conventions. The verbatim
 * attribute strings in `node.attrs` remain canonical (guaranteeing byte-level
 * roundtrips); these views exist for narrow targets (Figma/Flutter) and are
 * never stored back on the node.
 *
 * Conventions mirrored from src/lib/pro/effects.js and src/lib/pro/prototype.js.
 */

export type MaeEffect = {
  id?: string;
  type:
    | "drop-shadow"
    | "inner-shadow"
    | "layer-blur"
    | "background-blur"
    | "noise"
    | "texture"
    | "glass";
  enabled?: boolean;
  [key: string]: unknown;
};

export function getEffects(node: IRNode): MaeEffect[] {
  const raw = node.attrs["data-mae-effects"];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MaeEffect[]) : [];
  } catch {
    return [];
  }
}

export type NavSpec = {
  target: string;
  trigger: string;
  action: string;
  animation: string;
  duration: number;
  easing: string;
  delay: number;
  scrollTo?: string;
};

const NAV_DEFAULTS = {
  trigger: "click",
  action: "navigate",
  animation: "instant",
  duration: 300,
  easing: "ease",
  delay: 0,
} as const;

export function getInteraction(node: IRNode): NavSpec | null {
  const a = node.attrs;
  const action = a["data-nav-action"] || "navigate";
  const target = a["data-nav-to"] || "";
  if (!a["data-nav-to"] && !a["data-nav-action"]) return null;
  if (action === "navigate" && !target) return null;
  return {
    target,
    trigger: a["data-nav-trigger"] || NAV_DEFAULTS.trigger,
    action,
    animation: a["data-nav-animation"] || NAV_DEFAULTS.animation,
    duration: parseInt(a["data-nav-duration"] || String(NAV_DEFAULTS.duration), 10),
    easing: a["data-nav-easing"] || NAV_DEFAULTS.easing,
    delay: parseInt(a["data-nav-delay"] || String(NAV_DEFAULTS.delay), 10),
    scrollTo: a["data-nav-scroll"] || undefined,
  };
}

export type MaePosition = { x: number; y: number; flipX: boolean; flipY: boolean };

export function getMaePosition(node: IRNode): MaePosition | null {
  const x = node.attrs["data-mae-x"];
  const y = node.attrs["data-mae-y"];
  if (x == null && y == null) return null;
  return {
    x: parseFloat(x || "0") || 0,
    y: parseFloat(y || "0") || 0,
    flipX: node.attrs["data-mae-flip-x"] === "1",
    flipY: node.attrs["data-mae-flip-y"] === "1",
  };
}

export function getMaeType(node: IRNode): string | null {
  return node.attrs["data-mae-type"] || null;
}

export function getTextStyleRef(node: IRNode): string | null {
  return node.attrs["data-mae-textstyle"] || null;
}

/** True when the node is positioned by the editor's absolute convention. */
export function isEditorPositioned(node: IRNode): boolean {
  return getMaePosition(node) !== null || getDecl(node.styleDecls, "position") === "absolute";
}
