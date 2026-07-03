import { createGeminiProvider, createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { ProjectSchema, type Project } from "@/lib/screen-schema";
import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";

/**
 * Two-phase HTML generation.
 * Phase 1 → shared design system: CSS variables + tokens + shared chrome CSS
 *           returned as a JSON object { name, platform, palette, radius, font,
 *           designSystemCss, screenNames: [{id,name,role}] }
 * Phase 2 → for each screen: a self-contained HTML fragment constrained by the
 *           design system CSS (uses the CSS variables, sizes to 375x812).
 */

function extractJson(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall */ } }
  const s = t.indexOf("{"); const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error("No JSON found in model response");
}

function extractHtml(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)\s*```/i);
  if (fence) return fence[1].trim();
  return t;
}

function systemPhase1() {
  return `You are a senior mobile product designer. You define the shared design system for a mobile app.

Return ONLY a JSON object (no prose, no code fences) with this shape:
{
  "name": string,                       // short app name
  "platform": "ios" | "android",
  "palette": { "background":"#hex","surface":"#hex","text":"#hex","muted":"#hex","accent":"#hex","accentText":"#hex" },
  "radius": "sm"|"md"|"lg"|"xl",
  "font": "Inter"|"SF Pro"|"Roboto"|"Space Grotesk",
  "designSystemCss": string,            // full CSS: :root vars, base reset, .screen, .nav-bar, .tab-bar, .btn, .card, typography
  "screens": [ { "id": kebab, "name": string, "role": string } ]  // 4 or 5 screens forming a connected flow
}

designSystemCss requirements:
- Define CSS custom properties on :root or .screen for every palette color (--bg, --surface, --text, --muted, --accent, --accent-text), radius (--radius), font family (--font).
- Include a .screen root class sized to 375x812px, background: var(--bg), color: var(--text), font-family: var(--font), overflow hidden, flex column.
- Include reusable component classes: .status-bar, .nav-bar, .large-title, .tab-bar, .tab, .tab.active, .btn-primary, .btn-secondary, .card, .list, .list-item, .chip, .stat, .hero.
- iOS platform: SF-like typography, larger radii, generous whitespace. Android: Material, tighter radii, Roboto.
- No animations, no @keyframes, no external @import. Font family must be a websafe stack — do NOT rely on external font loading.`;
}

function systemPhase2() {
  return `You are a senior mobile product designer. You produce ONE mobile app screen as a self-contained HTML fragment.

Return ONLY the HTML fragment. No JSON, no code fences, no prose.

Rules:
- The root element MUST be <div class="screen" data-screen-id="..."> and contain the full screen content.
- USE the provided design system's CSS classes and CSS variables (var(--accent), .card, .btn-primary, .nav-bar, .tab-bar, .list-item, .chip, .stat, .hero, etc.). Prefer these over ad-hoc inline styles.
- You MAY add small inline styles for one-off tweaks, but never re-declare fonts, colors that duplicate palette tokens, or animations.
- Copy must be real and specific to the app idea — no Lorem ipsum, no "Placeholder".
- Include status bar, nav bar, and (if role warrants) a bottom tab bar with the SAME tab items across the app.
- Content only — no <html>, <head>, <body>, no external <link>/<script>, no <img> with external URLs (use CSS backgrounds / gradients / SVG data URIs for imagery).
- Fit natively inside a 375x812 phone frame; scroll happens inside a .screen__body if content overflows.`;
}

// Phase-1 result type
type Phase1 = {
  name: string;
  platform: "ios" | "android";
  palette: {
    background: string; surface: string; text: string; muted: string;
    accent: string; accentText: string;
  };
  radius: "sm" | "md" | "lg" | "xl";
  font: string;
  designSystemCss: string;
  screens: { id: string; name: string; role: string }[];
};

type Usage = { input: number; output: number; total: number };
const ZERO_USAGE: Usage = { input: 0, output: 0, total: 0 };
function readUsage(u: any): Usage {
  // ai SDK v5+ uses inputTokens/outputTokens; older uses promptTokens/completionTokens.
  const input = u?.inputTokens ?? u?.promptTokens ?? 0;
  const output = u?.outputTokens ?? u?.completionTokens ?? 0;
  const total = u?.totalTokens ?? input + output;
  return { input, output, total };
}
function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, total: a.total + b.total };
}

// Running total across every model call this server process has made — lets us
// compare our SDK-reported totals directly against Gemini's dashboard.
let SESSION = { calls: 0, input: 0, output: 0, total: 0 };

async function runModel(model: ReturnType<ReturnType<typeof createLovableAiGatewayProvider>>, system: string, prompt: string, retries = 3): Promise<{ text: string; usage: Usage }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const r = await generateText({ model, system, prompt });
      const usage = readUsage(r.usage);
      SESSION = { calls: SESSION.calls + 1, input: SESSION.input + usage.input, output: SESSION.output + usage.output, total: SESSION.total + usage.total };
      // Log the RAW usage object too — surfaces any extra fields Google bills
      // (reasoning/thinking tokens, cached input) that our totals might miss.
      console.log(`[token-usage] call @ ${new Date().toISOString()} | in=${usage.input} out=${usage.output} total=${usage.total} | raw=${JSON.stringify(r.usage)} | SESSION calls=${SESSION.calls} in=${SESSION.input} out=${SESSION.output} total=${SESSION.total}`);
      return { text: r.text, usage };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/unavailable|429|5\d\d|timeout|overload/i.test(msg)) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const lovableKey = process.env.LOVABLE_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!lovableKey && !geminiKey) {
          return new Response("Missing GEMINI_API_KEY or LOVABLE_API_KEY", { status: 500 });
        }
        const model = lovableKey
          ? createLovableAiGatewayProvider(lovableKey)("google/gemini-3-flash-preview")
          : createGeminiProvider(geminiKey!)("gemini-2.5-flash-lite");

        const body = (await request.json()) as {
          mode: "generate" | "refine" | "refine-element";
          idea?: string;
          platform?: "ios" | "android";
          // refine payload
          instruction?: string;
          screenHtml?: string;   // Lite mode single-screen refine
          elementHtml?: string;  // website imports: element-scoped refine
          designSystemCss?: string;
          projectContext?: { name: string; platform: string };
        };

        try {
          // Website imports: the full page is far too large for a model call,
          // so AI edits are scoped to one selected element.
          if (body.mode === "refine-element") {
            if (!body.elementHtml || !body.instruction) {
              return Response.json({ error: "refine-element requires elementHtml + instruction" }, { status: 400 });
            }
            const system = `You edit ONE HTML element from a captured web page. Return ONLY the updated element's HTML (no JSON, no code fences, no prose).
Rules:
- Keep the SAME outer tag and preserve every data-mae-id attribute exactly as given (including on descendants).
- Make ONLY the change the user asked for; keep all other attributes, classes, inline styles and children as-is.
- Do not add <script>, <iframe>, <form> or external resources.`;
            const prompt = `Page: ${body.projectContext?.name ?? ""}\n\nInstruction:\n${body.instruction}\n\nElement HTML:\n${body.elementHtml}`;
            const { text, usage } = await runModel(model, system, prompt);
            console.log(`[token-usage] refine-element | input=${usage.input} output=${usage.output} total=${usage.total}`);
            return Response.json({ html: extractHtml(text), usage: { mode: "refine-element", calls: 1, ...usage } });
          }

          if (body.mode === "refine") {
            if (!body.screenHtml || !body.instruction) {
              return Response.json({ error: "refine requires screenHtml + instruction" }, { status: 400 });
            }
            const system = `You edit ONE mobile app screen represented as an HTML fragment. Return ONLY the updated HTML fragment (no JSON, no code fences, no prose).
Preserve the outer <div class="screen" data-screen-id="..."> wrapper.
Keep using the provided design-system CSS variables/classes; do not redefine tokens.
Make ONLY the change the user asked for; leave the rest as-is.`;
            const prompt = `Design system CSS (context, do not modify):\n${body.designSystemCss ?? ""}\n\nApp: ${body.projectContext?.name ?? ""} (${body.projectContext?.platform ?? "ios"})\n\nInstruction:\n${body.instruction}\n\nCurrent screen HTML:\n${body.screenHtml}`;
            const { text, usage } = await runModel(model, system, prompt);
            console.log(`[token-usage] refine  | input=${usage.input} output=${usage.output} total=${usage.total}`);
            return Response.json({ html: extractHtml(text), usage: { mode: "refine", calls: 1, ...usage } });
          }

          // generate
          const idea = body.idea?.trim() || "A modern mobile app";
          const platform = body.platform ?? "ios";

          // Phase 1: shared design system + screen manifest
          const p1res = await runModel(model, systemPhase1(), `App idea: ${idea}\nTarget platform: ${platform}`);
          const p1raw = p1res.text;
          const p1 = extractJson(p1raw) as Phase1;
          if (!p1?.designSystemCss || !Array.isArray(p1.screens) || p1.screens.length === 0) {
            return Response.json({ error: "Phase 1 output invalid", raw: p1raw.slice(0, 500) }, { status: 502 });
          }

          // Phase 2: per-screen HTML in parallel
          const screensRaw = await Promise.all(
            p1.screens.map(async (s, i) => {
              const others = p1.screens.map((x, idx) => `${idx + 1}. ${x.name} — ${x.role}`).join("\n");
              const prompt = `App: ${p1.name} (${p1.platform})\nIdea: ${idea}\n\nAll screens in this app:\n${others}\n\nGenerate screen #${i + 1}: "${s.name}" (role: ${s.role}, id: ${s.id}).\n\nDesign system CSS you MUST use:\n${p1.designSystemCss}`;
              const r2 = await runModel(model, systemPhase2(), prompt);
              return { id: s.id, name: s.name, role: s.role, html: extractHtml(r2.text), usage: r2.usage };
            }),
          );
          const screensOut = screensRaw.map(({ usage: _u, ...s }) => s);

          // Aggregate token usage: phase 1 + every phase-2 screen call.
          const phase2Usage = screensRaw.reduce((acc, s) => addUsage(acc, s.usage), ZERO_USAGE);
          const totalUsage = addUsage(p1res.usage, phase2Usage);
          const usageReport = {
            mode: "generate",
            calls: 1 + screensRaw.length,
            phase1: p1res.usage,
            phase2_per_screen: screensRaw.map((s) => ({ screen: s.name, ...s.usage })),
            phase2_total: phase2Usage,
            total: totalUsage,
          };
          console.log(
            `[token-usage] generate | screens=${screensRaw.length} calls=${usageReport.calls} ` +
            `phase1(total=${p1res.usage.total}) phase2(total=${phase2Usage.total}) => GRAND TOTAL input=${totalUsage.input} output=${totalUsage.output} total=${totalUsage.total}`,
          );

          const project: Project = {
            id: crypto.randomUUID(),
            idea,
            name: p1.name,
            platform: p1.platform,
            designSystem: {
              palette: p1.palette,
              radius: p1.radius,
              font: p1.font,
            },
            designSystemCss: p1.designSystemCss,
            screens: screensOut,
          };

          const parsed = ProjectSchema.safeParse(project);
          if (!parsed.success) {
            console.error("Project validation failed", parsed.error.flatten());
            return Response.json({ error: "Model output failed validation", details: parsed.error.flatten() }, { status: 502 });
          }
          return Response.json({ project: parsed.data, usage: usageReport });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
