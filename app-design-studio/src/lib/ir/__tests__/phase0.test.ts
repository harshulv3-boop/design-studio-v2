import { describe, expect, it } from "vitest";
import { ensureIds } from "@/lib/pro/htmlUtils";
import { getEffects, getInteraction, getMaePosition } from "../core/attrs";
import { htmlToIrChildren } from "../core/html-to-ir";
import { parseInlineStyle, serializeInlineStyle } from "../core/inline-style";
import { irChildrenToHtml } from "../core/ir-to-html";
import { irToProjectFields, projectToIr } from "../core/project-bridge";
import { parseStylesheet } from "../core/stylesheet";
import { buildHtmlExport } from "../formats/html/export";
import { parseSleekHtmlExport, projectFromSleekHtmlExport } from "../formats/html/import";
import { isElement, type IRNode } from "../schema";
import { domDiff, expectDomEqual } from "./dom-equal";
import { DESIGN_CSS, SCREEN_FIXTURES, makeProject } from "./fixtures";

// ---------------------------------------------------------------------------
// Invariant 1 — inline style parse→serialize identity (lossless declarations)
// ---------------------------------------------------------------------------
describe("inline-style", () => {
  it("preserves order, unknown props, custom props and !important", () => {
    const input =
      "position:absolute; transform:translate(20px, 120px) scaleX(-1); --card-pad: 12px; " +
      "background-color:#f8fafc !important; unknown-prop: keep-me; padding: var(--card-pad)";
    const decls = parseInlineStyle(input);
    expect(decls).toEqual([
      ["position", "absolute", false],
      ["transform", "translate(20px, 120px) scaleX(-1)", false],
      ["--card-pad", "12px", false],
      ["background-color", "#f8fafc", true],
      ["unknown-prop", "keep-me", false],
      ["padding", "var(--card-pad)", false],
    ]);
    // Re-parsing the serialization yields the identical declaration list.
    expect(parseInlineStyle(serializeInlineStyle(decls))).toEqual(decls);
  });

  it("survives data-URI values containing ; and : inside url()", () => {
    const input =
      `background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E");` +
      `background:url(data:image/png;base64,iVBORw0KGgo=) no-repeat;color:#fff`;
    const decls = parseInlineStyle(input);
    expect(decls).toHaveLength(3);
    expect(decls[1][0]).toBe("background");
    expect(decls[1][1]).toContain("base64,iVBORw0KGgo=");
    expect(parseInlineStyle(serializeInlineStyle(decls))).toEqual(decls);
  });
});

// ---------------------------------------------------------------------------
// Invariant 2 — DOM-equal HTML roundtrip for every fixture
// ---------------------------------------------------------------------------
describe("html → IR → html roundtrip", () => {
  for (const [name, rawHtml] of Object.entries(SCREEN_FIXTURES)) {
    it(`fixture: ${name}`, async () => {
      // Canonical entry path: sanitize + assign ids (the single choke point).
      const canonical = ensureIds(rawHtml);
      const ir = await htmlToIrChildren(canonical);
      const out = await irChildrenToHtml(ir);
      expectDomEqual(out, canonical);
    });
  }

  it("roundtrip is idempotent (second pass is byte-stable)", async () => {
    const canonical = ensureIds(SCREEN_FIXTURES["app-home"]);
    const once = await irChildrenToHtml(await htmlToIrChildren(canonical));
    const twice = await irChildrenToHtml(await htmlToIrChildren(once));
    expect(twice).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// Invariant 3 — editor conventions parse correctly from verbatim attrs
// ---------------------------------------------------------------------------
describe("editor convention accessors", () => {
  async function findNodes(html: string): Promise<IRNode[]> {
    const out: IRNode[] = [];
    const walk = (children: Awaited<ReturnType<typeof htmlToIrChildren>>) => {
      for (const child of children) {
        if (isElement(child)) {
          out.push(child);
          walk(child.children);
        }
      }
    };
    walk(await htmlToIrChildren(ensureIds(html)));
    return out;
  }

  it("effects JSON round-trips verbatim and parses typed", async () => {
    const nodes = await findNodes(SCREEN_FIXTURES.effects);
    const withEffects = nodes.filter((n) => getEffects(n).length > 0);
    expect(withEffects).toHaveLength(4);
    const types = withEffects.flatMap((n) => getEffects(n).map((e) => e.type));
    expect(types).toEqual(
      expect.arrayContaining([
        "drop-shadow",
        "inner-shadow",
        "glass",
        "layer-blur",
        "noise",
        "texture",
      ]),
    );
    // Disabled effects stay present (they are user state, not render state).
    const blurNode = withEffects.find((n) =>
      getEffects(n).some((e) => e.type === "background-blur"),
    );
    expect(
      blurNode && getEffects(blurNode).find((e) => e.type === "background-blur")?.enabled,
    ).toBe(false);
  });

  it("nav interactions parse with prototype.js defaults", async () => {
    const nodes = await findNodes(SCREEN_FIXTURES["app-detail"]);
    const interactive = nodes.map((n) => getInteraction(n)).filter(Boolean);
    expect(interactive).toHaveLength(2);
    expect(interactive[0]).toMatchObject({ target: "home", animation: "slide", duration: 240 });
    expect(interactive[1]).toMatchObject({ target: "home", trigger: "press", action: "navigate" });
  });

  it("mae positions and flips parse from data attrs", async () => {
    const nodes = await findNodes(SCREEN_FIXTURES["canvas-primitives"]);
    const positioned = nodes.map((n) => getMaePosition(n)).filter(Boolean);
    expect(positioned).toHaveLength(4);
    expect(positioned[1]).toEqual({ x: 20, y: 120, flipX: true, flipY: false });
  });
});

// ---------------------------------------------------------------------------
// Invariant 4 — stylesheet advisory parse; raw is byte-preserved
// ---------------------------------------------------------------------------
describe("stylesheet", () => {
  it("keeps raw verbatim and extracts variables + fonts", async () => {
    const sheet = await parseStylesheet(DESIGN_CSS);
    expect(sheet.raw).toBe(DESIGN_CSS);
    expect(sheet.variables["--accent"]).toBe("#6d5ef2");
    expect(sheet.variables["--bg"]).toBe("#f6f7fb");
    expect(sheet.fonts).toEqual([expect.objectContaining({ family: "Sora", weights: ["700"] })]);
  });
});

// ---------------------------------------------------------------------------
// Invariant 5 — full project HTML export → import roundtrip (multi-screen)
// ---------------------------------------------------------------------------
describe("HTML format roundtrip", () => {
  it("project → standalone doc → project preserves everything", async () => {
    const project = makeProject({
      screens: [
        { id: "home", name: "Home", role: "home", html: ensureIds(SCREEN_FIXTURES["app-home"]) },
        {
          id: "detail",
          name: "Detail",
          role: "detail",
          html: ensureIds(SCREEN_FIXTURES["app-detail"]),
        },
        {
          id: "fx",
          name: "Effects Lab",
          role: "playground",
          html: ensureIds(SCREEN_FIXTURES.effects),
        },
      ],
    });

    const doc = await buildHtmlExport(project);
    const reimported = projectFromSleekHtmlExport(parseSleekHtmlExport(doc));

    // designSystemCss byte-identical through the code roundtrip.
    expect(reimported.designSystemCss).toBe(project.designSystemCss.trim());
    // Screen identity, names, roles, frame preserved.
    expect(reimported.screens.map((s) => [s.id, s.name, s.role])).toEqual(
      project.screens.map((s) => [s.id, s.name, s.role]),
    );
    expect(reimported.format_config?.frame?.width).toBe(375);
    // Every screen DOM-equal.
    for (let i = 0; i < project.screens.length; i++) {
      expectDomEqual(reimported.screens[i].html, project.screens[i].html);
    }
  });

  it("project-bridge roundtrip: projectToIr → irToProjectFields is DOM-equal", async () => {
    const project = makeProject({
      screens: [
        { id: "web", name: "Website", role: "page", html: ensureIds(SCREEN_FIXTURES.website) },
      ],
      format_config: { artifactType: "website", frame: { width: 1440 } },
    });
    const ir = await projectToIr(project);
    const fields = await irToProjectFields(ir);
    expect(fields.designSystemCss).toBe(project.designSystemCss);
    expect(domDiff(fields.screens[0].html, project.screens[0].html)).toBeNull();
  });
});
