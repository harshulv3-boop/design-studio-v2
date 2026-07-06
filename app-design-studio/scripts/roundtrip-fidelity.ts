/**
 * Round-trip fidelity report.
 *
 * The deliverable from the original prompt: "nothing should change when
 * importing or exporting." For each format, this exports a nontrivial canvas
 * project, re-imports it through the REAL /api/import-code route (real
 * sucrase/Vue/Angular compilers, no mocks), and asserts DOM equality between
 * the original and the re-imported HTML.
 *
 *   npx tsx scripts/roundtrip-fidelity.ts
 *
 * Requires the dev server running on :8082 (npm run dev).
 */
import { domDiff } from "@/lib/ir/__tests__/dom-equal";
import { ensureIds, sanitizeHtml } from "@/lib/pro/htmlUtils";
import {
  buildAngularProjectExport,
  buildHtmlExport,
  buildReactProjectExport,
  buildReactTsx,
  buildVueProjectExport,
} from "@/lib/ir";
import { isSleekHtmlExport, parseSleekHtmlExport, projectFromSleekHtmlExport } from "@/lib/ir";
import type { Project } from "@/lib/screen-schema";

const API = process.env.API_URL || "http://localhost:8082";

// A nontrivial screen: nested flex, button with a bold range, image, border,
// radius, custom CSS vars. Enough surface to catch real drift.
const SCREEN_HTML = ensureIds(sanitizeHtml(`<div class="screen" style="display:flex;flex-direction:column;gap:16px;padding:32px 20px;background:#f6f7fb">
  <header style="display:flex;align-items:center;justify-content:space-between">
    <h1 style="margin:0;font-size:28px;font-weight:700;letter-spacing:-0.02em">Portfolio</h1>
    <span style="font-size:13px;color:#6b7280">v2.0</span>
  </header>
  <section style="background:#fff;border-radius:16px;padding:16px;box-shadow:0 10px 30px rgba(15,23,42,0.08);display:flex;flex-direction:column;gap:8px">
    <span style="color:#6b7280;font-size:13px">Total balance</span>
    <strong style="font-size:34px;font-weight:700">$24,082.11</strong>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button style="flex:1;background:#6d5ef2;color:#fff;border:none;border-radius:12px;height:48px;font-weight:600">Invest</button>
      <button style="flex:1;background:rgba(109,94,242,0.12);color:#6d5ef2;border:none;border-radius:12px;height:48px;font-weight:600">Withdraw</button>
    </div>
  </section>
  <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px">
    <li style="background:#fff;border-radius:12px;padding:16px;display:flex;align-items:center;gap:12px"><span style="flex:1">NVDA</span><span style="color:#16a34a;font-weight:600">+4.2%</span></li>
    <li style="background:#fff;border-radius:12px;padding:16px;display:flex;align-items:center;gap:12px"><span style="flex:1">AAPL</span><span style="color:#dc2626;font-weight:600">-1.1%</span></li>
  </ul>
</div>`));

const project: Project = {
  id: "roundtrip",
  name: "Roundtrip Test",
  idea: "fidelity harness",
  platform: "ios",
  designSystem: { palette: {}, typography: {}, radius: "lg", font: "Inter" },
  designSystemCss: ":root { --accent:#6d5ef2; }",
  screens: [{ id: "home", name: "Home", role: "home", html: SCREEN_HTML }],
  format_config: { artifactType: "app", frame: { width: 375, height: 812 } },
} as unknown as Project;

type RoundtripResult = {
  format: string;
  ok: boolean;
  diff: string | null;
  exportedSize: number;
  importedSize: number;
};

async function importViaApi(code: string, language: string): Promise<string> {
  const res = await fetch(`${API}/api/import-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, language }),
  });
  const data = (await res.json().catch(() => null)) as {
    html?: string;
    screens?: { id: string; name: string; role: string; html: string }[];
    error?: string;
  } | null;
  if (!res.ok || (!data?.html && !data?.screens?.length)) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  // Multi-screen sleek exports come back as screens[] — stitch into one page
  // the same way ImportCode does when screens are present.
  if (data.screens && data.screens.length > 0) {
    return data.screens.map((s) => s.html).join("\n");
  }
  return data.html ?? "";
}

async function roundtripHtml(): Promise<RoundtripResult> {
  const exported = await buildHtmlExport(project);
  // HTML round-trip is parsed client-side in ImportCode, but here we exercise
  // the same parseSleekHtmlExport path the UI uses.
  if (isSleekHtmlExport(exported)) {
    const reimported = projectFromSleekHtmlExport(parseSleekHtmlExport(exported));
    const reimportedHtml = reimported.screens[0]?.html ?? "";
    return {
      format: "HTML",
      ok: true,
      diff: domDiff(SCREEN_HTML, reimportedHtml),
      exportedSize: exported.length,
      importedSize: reimportedHtml.length,
    };
  }
  return { format: "HTML", ok: false, diff: "not a sleek HTML export", exportedSize: exported.length, importedSize: 0 };
}

async function roundtripReact(): Promise<RoundtripResult> {
  // Single-file TSX path (uses the marker comment for multi-screen roundtrip).
  const exported = await buildReactTsx(project);
  const imported = await importViaApi(exported, "react");
  return {
    format: "React",
    ok: true,
    diff: domDiff(SCREEN_HTML, imported, { ignoreComments: true }),
    exportedSize: exported.length,
    importedSize: imported.length,
  };
}

async function roundtripVue(): Promise<RoundtripResult> {
  const files = await buildVueProjectExport(project);
  const appVue = files.find((f) => f.path.endsWith("App.vue")) || files[0];
  const imported = await importViaApi(appVue.content, "vue");
  return {
    format: "Vue",
    ok: true,
    diff: domDiff(SCREEN_HTML, imported, { ignoreComments: true }),
    exportedSize: appVue.content.length,
    importedSize: imported.length,
  };
}

async function roundtripAngular(): Promise<RoundtripResult> {
  const files = await buildAngularProjectExport(project);
  const component = files.find((f) => f.path.endsWith(".component.ts")) || files[0];
  const imported = await importViaApi(component.content, "angular");
  return {
    format: "Angular",
    ok: true,
    diff: domDiff(SCREEN_HTML, imported, { ignoreComments: true }),
    exportedSize: component.content.length,
    importedSize: imported.length,
  };
}

async function main() {
  console.log(`Round-trip fidelity report (API: ${API})\n`);
  const results: RoundtripResult[] = [];
  for (const [name, fn] of [
    ["HTML", roundtripHtml],
    ["React", roundtripReact],
    ["Vue", roundtripVue],
    ["Angular", roundtripAngular],
  ] as const) {
    process.stdout.write(`  ${name.padEnd(8)} `);
    try {
      const r = await fn();
      results.push(r);
      console.log(r.ok && !r.diff ? "✓ lossless" : `✗ DRIFT`);
      if (r.diff) console.log(`      ${r.diff}`);
    } catch (e) {
      console.log(`✗ ERROR: ${e instanceof Error ? e.message : e}`);
      results.push({ format: name, ok: false, diff: String(e), exportedSize: 0, importedSize: 0 });
    }
  }

  const passing = results.filter((r) => r.ok && !r.diff).length;
  console.log(`\n${passing}/${results.length} formats round-trip losslessly.`);

  if (passing < results.length) {
    console.log("\nDrift = a bug. Each diff above shows the exact path + reason;");
    console.log("that's the failure case to fix, not an acceptable loss.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fidelity run failed:", e);
  process.exit(1);
});
