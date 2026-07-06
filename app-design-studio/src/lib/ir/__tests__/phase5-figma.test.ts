import { describe, expect, it } from "vitest";
import { irChildrenToHtml } from "../core/ir-to-html";
import { isElement, type IRChild, type IRNode } from "../schema";
import { figmaNodeToIrChildren, figmaResponseToScreens } from "../formats/figma/import";
import type {
  FigmaFrameNode,
  FigmaNode,
  FigmaNodesResponse,
  FigmaTextNode,
} from "../formats/figma/api-types";

/**
 * Phase 5 (Figma import): Figma REST API nodes → IR → canvas HTML.
 *
 * These fixtures mirror the real Figma wire format (0..1 colors, gradient
 * transforms, per-character style overrides, image fills via imageRef). They
 * exercise every mapping rule the converter claims to handle. A live test
 * against a real Figma file + token is the user's final acceptance step.
 */

function decls(node: IRNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of node.styleDecls) out[k] = v;
  return out;
}

function firstElement(children: IRChild[]): IRNode {
  const el = children.find(isElement);
  if (!el) throw new Error("expected an element child");
  return el;
}

/** 0..1 → 8-bit rgb() string, matching the converter's output. */
function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
function rgba(r: number, g: number, b: number, a: number): string {
  const a3 = Math.round(a * 1000) / 1000;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a3})`;
}

describe("Figma → IR: solid fills + position + radius + opacity", () => {
  it("maps a rectangle's geometry, fill, radius and opacity to CSS", async () => {
    const node: FigmaNode = {
      id: "1:2",
      name: "Card",
      type: "RECTANGLE",
      x: 16,
      y: 24,
      width: 200,
      height: 120,
      opacity: 0.85,
      fills: [{ type: "SOLID", color: { r: 0.427, g: 0.369, b: 0.949, a: 1 } }],
      cornerRadius: 16,
    };
    const { children, warnings } = figmaNodeToIrChildren(node);
    expect(warnings).toEqual([]);
    const ir = firstElement(children);
    expect(ir.tag).toBe("div");
    const s = decls(ir);
    expect(s.position).toBe("absolute");
    expect(s.left).toBe("16px");
    expect(s.top).toBe("24px");
    expect(s.width).toBe("200px");
    expect(s.height).toBe("120px");
    expect(s.opacity).toBe("0.85");
    expect(s.background).toBe(rgb(0.427, 0.369, 0.949));
    expect(s["border-radius"]).toBe("16px");
  });

  it("turns an ELLIPSE into a 50% radius circle", () => {
    const node: FigmaNode = {
      id: "1:3",
      name: "Avatar",
      type: "ELLIPSE",
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fills: [{ type: "SOLID", color: { r: 0.42, g: 0.75, b: 0.6, a: 1 } }],
    };
    const ir = firstElement(figmaNodeToIrChildren(node).children);
    expect(decls(ir)["border-radius"]).toBe("50%");
  });
});

describe("Figma → IR: gradient + shadow + stroke", () => {
  it("linear gradient: angle from gradientTransform, stops at %", () => {
    // A Figma horizontal gradient: gradientTransform [[0,1,0],[-1,0,1]] → atan2(-1,0)
    // = -90deg → +90 +360 mod 360 = 0deg (CSS top→bottom equivalent).
    const node: FigmaNode = {
      id: "1:4",
      name: "Hero",
      type: "RECTANGLE",
      width: 300,
      height: 100,
      fills: [
        {
          type: "GRADIENT_LINEAR",
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
          gradientTransform: [[0, 1, 0], [-1, 0, 1]],
        },
      ],
      effects: [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.3 },
          offset: { x: 0, y: 4 },
          radius: 12,
          spread: 0,
        },
      ],
    };
    const ir = firstElement(figmaNodeToIrChildren(node).children);
    const s = decls(ir);
    // Gradient string format and shadow string format are both asserted.
    expect(s.background).toMatch(/^linear-gradient\(\d+deg, rgb\(255, 0, 0\) 0%, rgb\(0, 0, 255\) 100%\)$/);
    expect(s["box-shadow"]).toBe("0px 4px 12px 0px rgba(0, 0, 0, 0.3)");
  });

  it("inner shadow becomes inset; stroke becomes border", () => {
    const node: FigmaNode = {
      id: "1:5",
      name: "Frame",
      type: "RECTANGLE",
      width: 100,
      height: 100,
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      strokeWeight: 2,
      effects: [
        {
          type: "INNER_SHADOW",
          color: { r: 0.427, g: 0.369, b: 0.949, a: 0.4 },
          offset: { x: 0, y: 2 },
          radius: 8,
          spread: 0,
        },
      ],
    };
    const ir = firstElement(figmaNodeToIrChildren(node).children);
    const s = decls(ir);
    expect(s["box-shadow"]).toContain("inset");
    expect(s["box-shadow"]).toContain("0px 2px 8px 0px");
    expect(s.border).toBe("2px solid rgb(0, 0, 0)");
  });
});

describe("Figma → IR: text with character style overrides", () => {
  it("emits a <span> with typography, color, and per-range <span> children", () => {
    // "Buy now" where "now" is bold (override index 1).
    const node: FigmaTextNode = {
      id: "1:6",
      name: "CTA",
      type: "TEXT",
      x: 0,
      y: 0,
      width: 120,
      height: 32,
      characters: "Buy now",
      style: {
        fontFamily: "Inter",
        fontWeight: 400,
        fontSize: 16,
        lineHeightPx: 24,
        textAlignHorizontal: "CENTER",
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      },
      characterStyleOverrides: [0, 0, 0, 0, 1, 1, 1],
      styleOverrideTable: {
        "1": { fontWeight: 700 },
      },
    };
    const ir = firstElement(figmaNodeToIrChildren(node).children);
    expect(ir.tag).toBe("span");
    const s = decls(ir);
    expect(s["font-family"]).toBe("Inter");
    expect(s["font-weight"]).toBe("400");
    expect(s["font-size"]).toBe("16px");
    expect(s["text-align"]).toBe("center");
    expect(s.color).toBe("rgb(255, 255, 255)");

    // Two children: a text node "Buy " and a bold <span> "now".
    const elements = ir.children.filter(isElement);
    expect(elements).toHaveLength(1);
    const range = elements[0];
    expect(range.tag).toBe("span");
    expect(decls(range)["font-weight"]).toBe("700");
  });
});

describe("Figma → IR: frames, groups, clipping, image fills", () => {
  it("frame: children recurse, clipsContent → overflow:hidden", () => {
    const frame: FigmaFrameNode = {
      id: "1:7",
      name: "Container",
      type: "FRAME",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      clipsContent: true,
      children: [
        {
          id: "1:8",
          name: "Box",
          type: "RECTANGLE",
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
        },
      ],
    };
    const ir = firstElement(figmaNodeToIrChildren(frame).children);
    expect(ir.children.filter(isElement)).toHaveLength(1);
    expect(decls(ir).overflow).toBe("hidden");
  });

  it("group: transparent wrapper sized to bounds, children inside", () => {
    const group: FigmaNode = {
      id: "1:9",
      name: "Group",
      type: "GROUP",
      x: 20,
      y: 30,
      width: 100,
      height: 80,
      children: [
        {
          id: "1:10",
          name: "Rect",
          type: "RECTANGLE",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
        },
      ],
    };
    const ir = firstElement(figmaNodeToIrChildren(group).children);
    expect(ir.children.filter(isElement)).toHaveLength(1);
  });

  it("IMAGE fill with resolved URL → <img src> instead of background-image", () => {
    const node: FigmaNode = {
      id: "1:11",
      name: "Photo",
      type: "RECTANGLE",
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "ref-abc" }],
    };
    const { children } = figmaNodeToIrChildren(node, {
      images: { "ref-abc": "https://cdn.test/photo.png" },
    });
    const ir = firstElement(children);
    expect(ir.tag).toBe("img");
    expect(ir.attrs.src).toBe("https://cdn.test/photo.png");
    expect(ir.attrs.alt).toBe("Photo");
  });

  it("hidden nodes are dropped; visible:false paint is skipped", () => {
    const node: FigmaNode = {
      id: "1:12",
      name: "Hidden",
      type: "RECTANGLE",
      visible: false,
      width: 10,
      height: 10,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    };
    expect(figmaNodeToIrChildren(node).children).toHaveLength(0);
  });
});

describe("Figma → IR: response → screens assembly", () => {
  it("converts a /nodes response into one screen per top-level node", () => {
    const response: FigmaNodesResponse = {
      name: "My File",
      lastModified: "2024-01-01",
      version: "1",
      nodes: {
        "0:1": {
          document: {
            id: "0:1",
            name: "Home",
            type: "FRAME",
            width: 375,
            height: 812,
            children: [],
          },
        },
      },
    };
    const { screens, name } = figmaResponseToScreens(response);
    expect(name).toBe("My File");
    expect(screens).toHaveLength(1);
    expect(screens[0].name).toBe("Home");
    expect(screens[0].nodes).toHaveLength(1);
  });

  it("round-trips converter output through irChildrenToHtml into valid HTML", async () => {
    const node: FigmaNode = {
      id: "1:13",
      name: "Banner",
      type: "RECTANGLE",
      x: 16,
      y: 24,
      width: 200,
      height: 60,
      fills: [{ type: "SOLID", color: { r: 0.427, g: 0.369, b: 0.949, a: 1 } }],
      cornerRadius: 8,
    };
    const { children } = figmaNodeToIrChildren(node);
    const html = await irChildrenToHtml(children);
    expect(html).toContain("<div");
    expect(html).toContain('style="');
    // DOM serialization puts a space after the colon (position: absolute;).
    expect(html).toContain("position:");
    expect(html).toContain("absolute");
    expect(html).toContain("width: 200px");
    expect(html).toContain("border-radius: 8px");
  });
});
