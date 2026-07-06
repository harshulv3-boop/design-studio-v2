import { describe, expect, it } from "vitest";
import { ensureIds } from "@/lib/pro/htmlUtils";
import { htmlToIrChildren } from "../core/html-to-ir";
import { isElement, type IRChild, type IRNode } from "../schema";
import { buildFigmaExport } from "../formats/figma/export-nodes";
import { parseBackgroundImageLayer, parseColor } from "../formats/figma/style-map";
import type { FrameNodeSpec, TextNodeSpec } from "../formats/figma/types";
import { makeProject } from "./fixtures";

/**
 * Phase 4 (unit layer): the IR→figma-nodes mapping, driven by a synthetic
 * resolve pass (jsdom cannot do layout). Rects/computed styles are fabricated
 * deterministically per node, so every mapping rule — relative positioning,
 * auto-layout, mae-effects 1:1, image fills, text specs, gradients — is
 * asserted against known inputs. The REAL resolve pass is exercised by the
 * evidence-report script against the running clone engine.
 */

const SCREEN_HTML = `<div class="screen" style="display:flex;flex-direction:column;gap:12px;padding:24px 16px">
  <h1 style="font-size:28px;font-weight:700;color:#10131a;letter-spacing:-0.5px">Dashboard</h1>
  <div data-mae-type="rect" data-mae-effects='[{"id":"a","type":"drop-shadow","enabled":true,"x":0,"y":8,"blur":24,"spread":2,"color":"#102030","opacity":50},{"id":"b","type":"layer-blur","enabled":false,"blur":9}]' style="height:120px;background:linear-gradient(135deg,#6d5ef2,#a78bfa);border-radius:16px"></div>
  <button style="background:#6d5ef2;color:#ffffff;border-radius:12px;height:48px">Buy <b>now</b></button>
  <img src="data:image/png;base64,iVBORw0KGgo=" alt="hero" style="width:120px;height:80px;object-fit:contain" />
</div>`;

type FakeStyles = Record<string, Record<string, string>>;

/** Walk IR depth-first, fabricate rects (parent-origin +10 per level, 100x50
 * each, stacked vertically) and computed styles per tag. */
function fabricateResolve(children: IRChild[]): {
  nodes: Record<string, { rect: { x: number; y: number; w: number; h: number }; computed: Record<string, string>; imageNatural?: { w: number; h: number } }>;
} {
  const nodes: ReturnType<typeof fabricateResolve>["nodes"] = {};

  const styleFor = (node: IRNode): Record<string, string> => {
    const base: Record<string, string> = {
      display: "block",
      position: "static",
      opacity: "1",
      "font-family": "Inter, sans-serif",
      "font-size": "16px",
      "font-weight": "400",
      "line-height": "24px",
      "letter-spacing": "normal",
      "text-align": "left",
      color: "rgb(16, 19, 26)",
      "background-color": "rgba(0, 0, 0, 0)",
      "background-image": "none",
    };
    const overrides: FakeStyles = {
      div_root: {
        display: "flex",
        "flex-direction": "column",
        gap: "12px",
        "padding-top": "24px",
        "padding-right": "16px",
        "padding-bottom": "24px",
        "padding-left": "16px",
        "background-color": "rgb(246, 247, 251)",
      },
      h1: { "font-size": "28px", "font-weight": "700", "letter-spacing": "-0.5px" },
      div_fx: {
        "background-image": "linear-gradient(135deg, rgb(109, 94, 242) 0%, rgb(167, 139, 250) 100%)",
        "border-top-left-radius": "16px",
        "border-top-right-radius": "16px",
        "border-bottom-right-radius": "16px",
        "border-bottom-left-radius": "16px",
      },
      button: {
        "background-color": "rgb(109, 94, 242)",
        color: "rgb(255, 255, 255)",
        "border-top-left-radius": "12px",
        "border-top-right-radius": "12px",
        "border-bottom-right-radius": "12px",
        "border-bottom-left-radius": "12px",
        "text-align": "center",
      },
      b: { "font-weight": "700", color: "rgb(255, 255, 255)" }, // inherits button color
      img: { "object-fit": "contain" },
    };
    const key =
      node.tag === "div" && node.classes.includes("screen")
        ? "div_root"
        : node.tag === "div"
          ? "div_fx"
          : node.tag;
    return { ...base, ...(overrides[key] ?? {}) };
  };

  let cursorY = 0;
  const walk = (list: IRChild[], originX: number, originY: number): void => {
    for (const child of list) {
      if (!isElement(child)) continue;
      const isRoot = child.classes.includes("screen");
      const rect = isRoot
        ? { x: 0, y: 0, w: 375, h: 812 }
        : { x: originX + 16, y: (cursorY += 60), w: 200, h: 50 };
      nodes[child.id] = { rect, computed: styleFor(child) };
      if (child.tag === "img") nodes[child.id].imageNatural = { w: 120, h: 80 };
      walk(child.children, rect.x, rect.y);
    }
  };
  walk(children, 0, 0);
  return { nodes };
}

async function exportFixture() {
  const html = ensureIds(SCREEN_HTML);
  const project = makeProject({
    screens: [{ id: "dash", name: "Dashboard", role: "home", html }],
  });
  const ir = await htmlToIrChildren(html);
  const fake = fabricateResolve(ir);

  const fetchImpl = (async () =>
    new Response(JSON.stringify({ pageHeight: 812, nodes: fake.nodes, warnings: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  return buildFigmaExport(project, { fetchImpl, endpoint: "http://fake/resolve" });
}

describe("Figma export nodes", () => {
  it("maps the screen to a frame tree with relative positions and auto-layout", async () => {
    const doc = await exportFixture();
    expect(doc.schema).toBe("sleek.figma-nodes");
    expect(doc.frames).toHaveLength(1);

    const screen = doc.frames[0];
    expect(screen.width).toBe(375);
    const root = screen.children[0] as FrameNodeSpec;
    expect(root.type).toBe("FRAME");
    expect(root.layout).toMatchObject({
      mode: "VERTICAL",
      itemSpacing: 12,
      padding: { top: 24, right: 16, bottom: 24, left: 16 },
    });

    // Children positioned relative to the root frame (fabricated: x=16 vs root x=0).
    const heading = root.children.find((c) => c.type === "TEXT") as TextNodeSpec;
    expect(heading.x).toBe(16);
    expect(heading.fontSize).toBe(28);
    expect(heading.fontWeight).toBe(700);
    expect(heading.letterSpacing).toBe(-0.5);
    expect(heading.characters).toBe("Dashboard");
  });

  it("maps data-mae-effects 1:1 (disabled effects dropped) + gradient fill", async () => {
    const doc = await exportFixture();
    const root = doc.frames[0].children[0] as FrameNodeSpec;
    const fx = root.children.find((c) => c.type === "RECTANGLE" && c.effects?.length);
    expect(fx).toBeTruthy();
    expect(fx!.effects).toEqual([
      {
        type: "DROP_SHADOW",
        color: { r: 16 / 255, g: 32 / 255, b: 48 / 255, a: 0.5 },
        offset: { x: 0, y: 8 },
        radius: 24,
        spread: 2,
      },
    ]);
    expect(fx!.fills).toEqual([
      {
        type: "GRADIENT_LINEAR",
        angleDeg: 135,
        stops: [
          { position: 0, color: parseColor("rgb(109, 94, 242)") },
          { position: 1, color: parseColor("rgb(167, 139, 250)") },
        ],
      },
    ]);
    expect(fx!.cornerRadius).toEqual({ tl: 16, tr: 16, br: 16, bl: 16 });
  });

  it("renders a boxed text (button) as frame + text child with range styling", async () => {
    const doc = await exportFixture();
    const root = doc.frames[0].children[0] as FrameNodeSpec;
    const button = root.children.find(
      (c) => c.type === "FRAME" && (c as FrameNodeSpec).children.some((k) => k.type === "TEXT"),
    ) as FrameNodeSpec;
    expect(button).toBeTruthy();
    const text = button.children[0] as TextNodeSpec;
    expect(text.characters).toBe("Buy now");
    expect(text.textAlign).toBe("CENTER");
    // <b>now</b> gets a bold range at offset 4..7.
    expect(text.ranges).toEqual([{ start: 4, end: 7, fontWeight: 700 }]);
  });

  it("maps img to rectangle with IMAGE fill honoring object-fit", async () => {
    const doc = await exportFixture();
    const root = doc.frames[0].children[0] as FrameNodeSpec;
    const img = root.children.find(
      (c) => c.type === "RECTANGLE" && c.fills?.some((f) => f.type === "IMAGE"),
    );
    expect(img).toBeTruthy();
    const fill = img!.fills!.find((f) => f.type === "IMAGE") as { type: "IMAGE"; url: string; scaleMode: string };
    expect(fill.url).toContain("data:image/png;base64");
    expect(fill.scaleMode).toBe("FIT");
  });
});

describe("style-map primitives", () => {
  it("parses gradient layers with default and positionless stops", () => {
    const warnings: string[] = [];
    const fill = parseBackgroundImageLayer(
      "linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))",
      warnings,
    );
    expect(fill).toEqual({
      type: "GRADIENT_LINEAR",
      angleDeg: 180,
      stops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
    });
    expect(warnings).toHaveLength(0);
  });

  it("keeps url() layers as IMAGE fills and warns on radial gradients", () => {
    const warnings: string[] = [];
    const image = parseBackgroundImageLayer('url("https://x.test/a.png")', warnings);
    expect(image).toMatchObject({ type: "IMAGE", url: "https://x.test/a.png" });
    const radial = parseBackgroundImageLayer("radial-gradient(rgb(1, 2, 3), rgb(4, 5, 6))", warnings);
    expect(radial).toMatchObject({ type: "SOLID" });
    expect(warnings.some((w) => w.includes("radial"))).toBe(true);
  });
});
