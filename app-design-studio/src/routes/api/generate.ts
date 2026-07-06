import {
  createGeminiProvider,
  createLovableAiGatewayProvider,
  createOpenAiProvider,
} from "@/lib/ai-gateway.server";
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
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall */
    }
  }
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error("No JSON found in model response");
}

function extractHtml(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)\s*```/i);
  if (fence) return fence[1].trim();
  return t;
}

// Run `fn` over `items` with at most `limit` in flight at once, preserving
// input order in the result. Independent model calls (screens) parallelize
// safely; the limit avoids bursting the provider's rate limit on large apps.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function compactCssForTheme(css: string, maxChars = 40_000): string {
  const cleaned = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  const rootMatches =
    cleaned.match(/(?:^|[^\w-])(?::root|\.screen|body|html)[^{]*\{[^}]*\}/gi) ?? [];
  const importantMatches =
    cleaned.match(
      /[^{}]*(?:color|font|button|card|hero|nav|header|footer|section|container|page|screen)[^{}]*\{[^}]*\}/gi,
    ) ?? [];
  const prioritized = [...rootMatches, ...importantMatches].join("\n").slice(0, maxChars);
  return prioritized || cleaned.slice(0, maxChars);
}

function systemPhase1(screenCount?: number) {
  const screenInstruction = screenCount
    ? `EXACTLY ${screenCount} screens forming a connected flow`
    : "4 or 5 screens forming a connected flow";
  return `You are a senior mobile product designer. You define the shared design system for a mobile app.

Return ONLY a JSON object (no prose, no code fences) with this shape:
{
  "name": string,                       // short app name
  "platform": "ios" | "android",
  "palette": { "background":"#hex","surface":"#hex","text":"#hex","muted":"#hex","accent":"#hex","accentText":"#hex" },
  "radius": "sm"|"md"|"lg"|"xl",
  "font": "Inter"|"SF Pro"|"Roboto"|"Space Grotesk",
  "designSystemCss": string,            // full CSS: :root vars, base reset, .screen, .nav-bar, .tab-bar, .btn, .card, typography
  "screens": [ { "id": kebab, "name": string, "role": string } ]  // ${screenInstruction}
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

function systemDesignFromInstruction() {
  return `You are a senior product design system director restyling an app. Return ONLY a JSON object matching this shape:
{
  "palette": { "background":"#hex","surface":"#hex","text":"#hex","muted":"#hex","accent":"#hex","accentText":"#hex" },
  "radius": "sm"|"md"|"lg"|"xl",
  "font": string,
  "designSystemCss": string
}
Let the INSTRUCTION and REFERENCE drive the visual direction — YOU decide how far to go:
- If a reference/brand is given, infer its palette, typography, mood and interaction feel and commit to that direction (change colors, font, light/dark, radii as the reference implies). If only a light instruction is given, make a proportionate change. Do not force the result to resemble the current design when the reference points elsewhere.
- Choose whatever font best fits the direction.
STRUCTURAL rules (these must hold so the app doesn't break — they do NOT constrain the look):
- Keep the SAME CSS variable names the app uses: --bg, --surface, --text, --muted, --accent, --accent-text, --radius, --font. Do NOT rename or drop the component classes the screens rely on (.screen, .nav-bar, .tab-bar, .btn-primary, .card, etc.) — restyle them, keep the selectors.
- Ensure text/background contrast stays legible.
Return production-quality mobile UI tokens. No prose, no markdown.`;
}

function systemWebsiteDesignFromInstruction() {
  return `You are a senior web design system director restyling a captured website project.
Return ONLY a JSON object matching this shape:
{
  "palette": { "background":"#hex","surface":"#hex","text":"#hex","muted":"#hex","accent":"#hex","accentText":"#hex" },
  "radius": "sm"|"md"|"lg"|"xl",
  "font": string,
  "designSystemCss": string
}
Rules:
- This is AI interpretation only. Do NOT clone, scrape, copy, or import CSS from any reference URL.
- Let the INSTRUCTION and REFERENCE drive the visual direction — YOU decide how far to go. If a reference/brand is given, infer its color, typography and mood language and commit to that direction (change palette, fonts, light/dark as the reference implies); the result does NOT need to resemble the current site. If only a light instruction is given, make a proportionate change.
- STRUCTURAL (must hold, does NOT constrain the look): preserve existing selector intent and page structure — do not rename or drop selectors, do not require HTML rewrites. Keep text/background contrast legible.
- Preserve editability: do not add scripts, iframes, forms, external resources, @import, or remote fonts.
- Prefer CSS variables or top-level reusable rules when they already exist, but captured website CSS may not use app tokens.
- Keep the output CSS complete enough to replace the current captured CSS. No prose, no markdown.`;
}

function systemExtraScreen() {
  return `You are a senior mobile product designer. Generate ONE additional mobile app screen that exactly matches the existing app design system.
Return ONLY the HTML fragment. No JSON, no code fences, no prose.
The root element MUST be <div class="screen" data-screen-id="...">.
Use the provided CSS variables/classes and match the existing visual language, navigation, density, and hierarchy.
No <html>, <head>, <body>, external <script>, or external <img>.`;
}

// Phase-1 result type
type Phase1 = {
  name: string;
  platform: "ios" | "android";
  palette: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    accentText: string;
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

// Per-mode output-token caps. The model (glm-5.2) is a REASONING model: without
// a cap it burns 60-70% of its output budget "thinking" and can run away for
// minutes on a single screen (measured: 250s, 11.9k reasoning tokens, before
// this change). Capping output + forcing reasoning_effort=minimal (see
// getGenerationModel) brought a single screen to ~45s. These caps are generous
// upper bounds sized to the largest legitimate outputs we've observed.
const MAX_TOKENS = {
  plan: 6000, // Phase-1 JSON: design system CSS + screen manifest
  screen: 8000, // one full HTML screen fragment
  refine: 8000, // an edited screen / element
  theme: 6000, // design-system JSON (palette + CSS)
} as const;

// Hard wall-clock ceiling for any single model call, independent of the
// client. Prevents a hung upstream from pinning a request/quota forever.
const MODEL_CALL_TIMEOUT_MS = 90_000;

type ModelTuning = {
  model: ReturnType<ReturnType<typeof createLovableAiGatewayProvider>>;
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
};

type RunModelOpts = {
  maxOutputTokens?: number;
  retries?: number;
  abortSignal?: AbortSignal;
};

async function runModel(
  tuning: ModelTuning,
  system: string,
  prompt: string,
  opts: RunModelOpts = {},
): Promise<{ text: string; usage: Usage }> {
  const { maxOutputTokens, retries = 3, abortSignal } = opts;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Combine the caller's abort signal with a hard per-call timeout so a
      // single call can never run unbounded (protects quota + throughput).
      const timeout = AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS);
      const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
      const r = await generateText({
        model: tuning.model,
        system,
        prompt,
        abortSignal: signal,
        maxOutputTokens,
        providerOptions: tuning.providerOptions,
      });
      const usage = readUsage(r.usage);
      SESSION = {
        calls: SESSION.calls + 1,
        input: SESSION.input + usage.input,
        output: SESSION.output + usage.output,
        total: SESSION.total + usage.total,
      };
      // Log the RAW usage object too — surfaces any extra fields the provider
      // bills (reasoning/thinking tokens, cached input) that our totals might miss.
      console.log(
        `[token-usage] call @ ${new Date().toISOString()} | in=${usage.input} out=${usage.output} total=${usage.total} | raw=${JSON.stringify(r.usage)} | SESSION calls=${SESSION.calls} in=${SESSION.input} out=${SESSION.output} total=${SESSION.total}`,
      );
      return { text: r.text, usage };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Caller-driven cancellation is terminal; a per-call timeout is retryable.
      if (abortSignal?.aborted) break;
      if (!/unavailable|429|5\d\d|timeout|overload|aborted|timed out/i.test(msg)) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

type GenerationJobStatus =
  "queued" | "planning" | "generating" | "completed" | "failed" | "cancelled";
type GenerationJob = {
  id: string;
  idea: string;
  platform: "ios" | "android";
  status: GenerationJobStatus;
  progress: string[];
  project: Project | null;
  error?: string;
  currentScreenIndex?: number;
  abortController: AbortController;
  createdAt: number;
  updatedAt: number;
  screenCount?: number;
};

function normalizeScreenCount(value: unknown): number | undefined {
  if (value === "auto" || value === undefined || value === null) return undefined;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(24, Math.round(n)));
}

function coercePlanScreensToCount(screens: Phase1["screens"], count?: number): Phase1["screens"] {
  if (!count || screens.length === count) return screens;
  const out = screens.slice(0, count);
  const fallback = [
    "Home",
    "Dashboard",
    "Explore",
    "Details",
    "Profile",
    "Settings",
    "Notifications",
    "Analytics",
    "Search",
    "Inbox",
    "Activity",
    "Summary",
  ];
  while (out.length < count) {
    const name = fallback[out.length] ?? `Screen ${out.length + 1}`;
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    out.push({ id, name, role: id || `screen-${out.length + 1}` });
  }
  return out;
}

// In-memory job registry. NOTE: process-local — a multi-instance / multi-isolate
// deployment needs this swapped for a shared store (KV / Durable Object / Redis)
// so status polls land on the same state that started the job. Kept behind these
// three helpers (getJob / setJob / sweepJobs) so that swap is a localized change.
const generationJobs = new Map<string, GenerationJob>();

// A finished job is kept this long so the client can still read its final state;
// an in-flight job older than the hard cap is treated as abandoned and evicted.
const JOB_DONE_TTL_MS = 5 * 60_000;
const JOB_MAX_AGE_MS = 30 * 60_000;

function sweepJobs() {
  const now = Date.now();
  for (const [id, job] of generationJobs) {
    const done =
      job.status === "completed" || job.status === "failed" || job.status === "cancelled";
    if (done && now - job.updatedAt > JOB_DONE_TTL_MS) generationJobs.delete(id);
    else if (now - job.createdAt > JOB_MAX_AGE_MS) {
      job.abortController.abort();
      generationJobs.delete(id);
    }
  }
}

function getGenerationModel(): ModelTuning {
  const openAiKey = process.env.OPENAI_API_KEY;
  const openAiBaseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL ?? "https://api.inference.net/v1";
  const openAiModel = process.env.OPENAI_MODEL ?? "gpt-5.5";
  const lovableKey = process.env.LOVABLE_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!openAiKey && !lovableKey && !geminiKey) {
    throw new Error("Missing OPENAI_API_KEY, GEMINI_API_KEY, or LOVABLE_API_KEY");
  }
  if (openAiKey) {
    // OpenAI-compatible providers (incl. reasoning models like glm-5.2). Force
    // reasoning_effort=minimal: for structured HTML/CSS generation the model's
    // chain-of-thought is pure latency+cost with no quality benefit, and it's
    // the single biggest lever measured (250s -> 45s per screen). Overridable
    // via OPENAI_REASONING_EFFORT for models/endpoints that ignore or dislike it.
    const reasoningEffort = process.env.OPENAI_REASONING_EFFORT ?? "minimal";
    // Provider is created with name "openai-compatible"; the SDK reads provider
    // options under the camelCase key "openaiCompatible".
    return {
      model: createOpenAiProvider(openAiKey, openAiBaseUrl)(openAiModel),
      providerOptions: reasoningEffort ? { openaiCompatible: { reasoningEffort } } : undefined,
    };
  }
  return lovableKey
    ? { model: createLovableAiGatewayProvider(lovableKey)("google/gemini-3-flash-preview") }
    : { model: createGeminiProvider(geminiKey!)("gemini-2.5-flash-lite") };
}

function updateJob(job: GenerationJob, patch: Partial<GenerationJob>) {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function pushProgress(job: GenerationJob, message: string) {
  job.progress.push(message);
  job.updatedAt = Date.now();
}

function serializeJob(job: GenerationJob) {
  const { abortController: _abortController, ...safeJob } = job;
  return safeJob;
}

// How many screen calls run concurrently. Screens are independent (each needs
// only the plan + shared CSS), so this is safe to parallelize; the cap keeps us
// from bursting the provider's rate limit on large apps. 4 covers the typical
// 4-5 screen app in a single wave.
const SCREEN_CONCURRENCY = 4;

async function runGenerationJob(job: GenerationJob) {
  try {
    const model = getGenerationModel();
    updateJob(job, { status: "planning" });
    pushProgress(job, "Creating navigation and design system...");

    const screenCount = job.screenCount;
    const phase1Prompt =
      screenCount !== undefined
        ? `App idea: ${job.idea}\nTarget platform: ${job.platform}\n\nThe user selected exactly ${screenCount} screen(s). Return exactly ${screenCount} screens. Choose the best screen types for the app idea.`
        : `App idea: ${job.idea}\nTarget platform: ${job.platform}`;

    const p1res = await runModel(model, systemPhase1(screenCount), phase1Prompt, {
      maxOutputTokens: MAX_TOKENS.plan,
      abortSignal: job.abortController.signal,
    });
    if (job.abortController.signal.aborted) throw new Error("Generation cancelled");
    const plan = extractJson(p1res.text) as Phase1;
    if (!plan?.designSystemCss || !Array.isArray(plan.screens) || plan.screens.length === 0) {
      throw new Error("Planning output invalid");
    }
    plan.screens = coercePlanScreensToCount(plan.screens, screenCount);

    const project: Project = {
      id: crypto.randomUUID(),
      idea: job.idea,
      name: plan.name,
      platform: plan.platform,
      designSystem: { palette: plan.palette, radius: plan.radius, font: plan.font },
      designSystemCss: plan.designSystemCss,
      screens: [],
    };
    updateJob(job, { status: "generating", project });
    pushProgress(job, "Design system ready. Building screens now...");

    // Phase 2: generate screens in parallel (bounded), appending each to the
    // project as soon as it resolves so the polling UI renders screens one by
    // one as they land — rather than waiting for the whole batch. A shared
    // cursor hands work to SCREEN_CONCURRENCY workers.
    const others = plan.screens.map((x, idx) => `${idx + 1}. ${x.name} — ${x.role}`).join("\n");
    const results: (Project["screens"][number] | null)[] = new Array(plan.screens.length).fill(
      null,
    );
    let completed = 0;
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= plan.screens.length) return;
        if (job.abortController.signal.aborted) throw new Error("Generation cancelled");
        const screen = plan.screens[i];
        const prompt = `App: ${plan.name} (${plan.platform})\nIdea: ${job.idea}\n\nAll screens in this app:\n${others}\n\nGenerate screen #${i + 1}: "${screen.name}" (role: ${screen.role}, id: ${screen.id}).\n\nDesign system CSS you MUST use:\n${plan.designSystemCss}`;
        const result = await runModel(model, systemPhase2(), prompt, {
          maxOutputTokens: MAX_TOKENS.screen,
          abortSignal: job.abortController.signal,
        });
        if (job.abortController.signal.aborted) throw new Error("Generation cancelled");
        results[i] = { ...screen, html: extractHtml(result.text) };
        completed++;
        // Publish EVERY completed screen immediately (compacted, in plan order),
        // not just a contiguous prefix — so a slow screen #0 doesn't hide the
        // screens that already finished. `filter` preserves ascending plan
        // order, so screens settle into final order as earlier ones land.
        const ready = results.filter((s): s is Project["screens"][number] => s !== null);
        project.screens = ready;
        updateJob(job, {
          project: { ...project, screens: [...ready] },
          currentScreenIndex: completed,
        });
        pushProgress(job, `${screen.name} ready. (${completed}/${plan.screens.length})`);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SCREEN_CONCURRENCY, plan.screens.length) }, worker),
    );

    // Ensure every screen (including any that finished out of prefix order) is
    // present in final plan order.
    project.screens = results.filter((s): s is Project["screens"][number] => s !== null);
    updateJob(job, { project: { ...project, screens: [...project.screens] } });

    pushProgress(job, "Finalizing design...");
    updateJob(job, { status: "completed", currentScreenIndex: undefined });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (job.abortController.signal.aborted || /cancelled/i.test(message)) {
      pushProgress(job, "Generation cancelled.");
      updateJob(job, { status: "cancelled", error: "Generation cancelled" });
      return;
    }
    pushProgress(job, `Generation failed: ${message}`);
    updateJob(job, { status: "failed", error: message });
  }
}

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          mode:
            | "start-generation"
            | "generation-status"
            | "cancel-generation"
            | "design-system"
            | "website-design-system"
            | "extra-screen"
            | "generate"
            | "generate-plan"
            | "generate-screen"
            | "refine"
            | "refine-element";
          jobId?: string;
          idea?: string;
          platform?: "ios" | "android";
          plan?: Phase1;
          screenIndex?: number;
          screenName?: string;
          purpose?: string;
          sourceUrl?: string;
          project?: Project;
          // refine payload
          instruction?: string;
          screenHtml?: string; // Lite mode single-screen refine
          elementHtml?: string; // website imports: element-scoped refine
          designSystemCss?: string;
          websiteCss?: string;
          projectContext?: { name: string; platform: string };
          screenCount?: number | "auto";
        };

        try {
          if (body.mode === "start-generation") {
            sweepJobs(); // evict finished/abandoned jobs before adding a new one
            const job: GenerationJob = {
              id: crypto.randomUUID(),
              idea: body.idea?.trim() || "A modern mobile app",
              platform: body.platform ?? "ios",
              status: "queued",
              progress: ["Generation job started."],
              project: null,
              abortController: new AbortController(),
              createdAt: Date.now(),
              updatedAt: Date.now(),
              screenCount: normalizeScreenCount(body.screenCount),
            };
            generationJobs.set(job.id, job);
            void runGenerationJob(job);
            return Response.json({ jobId: job.id, job: serializeJob(job) });
          }

          if (body.mode === "generation-status") {
            if (!body.jobId)
              return Response.json({ error: "generation-status requires jobId" }, { status: 400 });
            const job = generationJobs.get(body.jobId);
            if (!job) return Response.json({ error: "Generation job not found" }, { status: 404 });
            return Response.json({ job: serializeJob(job) });
          }

          if (body.mode === "cancel-generation") {
            if (!body.jobId)
              return Response.json({ error: "cancel-generation requires jobId" }, { status: 400 });
            const job = generationJobs.get(body.jobId);
            if (!job) return Response.json({ error: "Generation job not found" }, { status: 404 });
            job.abortController.abort();
            updateJob(job, { status: "cancelled", error: "Generation cancelled" });
            pushProgress(job, "Generation cancelled.");
            return Response.json({ job: serializeJob(job) });
          }

          const model = getGenerationModel();

          if (body.mode === "design-system") {
            if (!body.project)
              return Response.json({ error: "design-system requires project" }, { status: 400 });
            const instruction =
              body.instruction?.trim() ||
              (body.sourceUrl
                ? `Use ${body.sourceUrl} as a brand/style reference and reinterpret that visual direction for this app.`
                : "Improve this design system");
            // Compact the current CSS (strip comments/whitespace, cap length) so a
            // large design system can't inflate the prompt — same treatment the
            // website-design-system path already applies.
            const currentCss = compactCssForTheme(body.project.designSystemCss ?? "");
            const prompt = `Instruction: ${instruction}\n\nReference URL, if any: ${body.sourceUrl ?? "none"}\nImportant: Do not clone, scrape, or copy CSS from the reference URL. Infer the likely brand direction, mood, color/typography language, and interaction feel, then create an original app design system inspired by it.\n\nCurrent app idea: ${body.project.idea}\nCurrent project name: ${body.project.name}\nCurrent platform: ${body.project.platform}\nCurrent design system JSON:\n${JSON.stringify(body.project.designSystem)}\n\nCurrent designSystemCss:\n${currentCss}\n\nReturn the updated design system only.`;
            const result = await runModel(model, systemDesignFromInstruction(), prompt, {
              maxOutputTokens: MAX_TOKENS.theme,
              abortSignal: request.signal,
            });
            const next = extractJson(result.text) as {
              palette: Project["designSystem"]["palette"];
              radius: Project["designSystem"]["radius"];
              font: Project["designSystem"]["font"];
              designSystemCss: string;
            };
            if (!next?.palette || !next?.designSystemCss)
              return Response.json({ error: "Design system output invalid" }, { status: 502 });
            return Response.json({
              designSystem: { palette: next.palette, radius: next.radius, font: next.font },
              designSystemCss: next.designSystemCss,
            });
          }

          if (body.mode === "website-design-system") {
            if (!body.project)
              return Response.json(
                { error: "website-design-system requires project" },
                { status: 400 },
              );
            const instruction =
              body.instruction?.trim() ||
              (body.sourceUrl
                ? `Use ${body.sourceUrl} as a brand/style reference and reinterpret that visual direction for this website.`
                : "Improve this website design system");
            const rawCss = body.websiteCss ?? body.project.designSystemCss ?? "";
            const currentCss = compactCssForTheme(rawCss);
            const selectedHtml = (body.screenHtml ?? "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 12_000);
            console.log(
              `[ai-theme] website-design-system project=${body.project.id} cssChars=${rawCss.length} compactCssChars=${currentCss.length} htmlChars=${selectedHtml.length} sourceUrl=${body.sourceUrl ? "yes" : "no"}`,
            );
            const prompt = `Instruction: ${instruction}

Reference URL, if any: ${body.sourceUrl ?? "none"}
Important: Do not clone, scrape, or copy CSS from the reference URL. Infer the likely brand direction, mood, color/typography language, and interaction feel, then create an original website theme inspired by it.

Current website project: ${body.project.name}
Current source URL: ${(body.project as any)?.format_config?.source?.url ?? "unknown"}
Current frame width: ${(body.project as any)?.format_config?.frame?.width ?? "unknown"}
Current design system JSON:
${JSON.stringify(body.project.designSystem)}

Representative page HTML context (read-only, preserve data-mae-id compatibility; do not return HTML):
${selectedHtml || "none"}

Current captured CSS to restyle and return as a full replacement:
${currentCss}

Return the updated website design system only.`;
            const result = await runModel(model, systemWebsiteDesignFromInstruction(), prompt, {
              maxOutputTokens: MAX_TOKENS.theme,
              abortSignal: request.signal,
            });
            const next = extractJson(result.text) as {
              palette: Project["designSystem"]["palette"];
              radius: Project["designSystem"]["radius"];
              font: Project["designSystem"]["font"];
              designSystemCss: string;
            };
            if (!next?.palette || !next?.designSystemCss)
              return Response.json(
                { error: "Website design system output invalid" },
                { status: 502 },
              );
            return Response.json({
              designSystem: { palette: next.palette, radius: next.radius, font: next.font },
              designSystemCss: next.designSystemCss,
            });
          }

          if (body.mode === "extra-screen") {
            if (!body.project)
              return Response.json({ error: "extra-screen requires project" }, { status: 400 });
            const name = body.screenName?.trim() || "New Screen";
            const id =
              name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") || crypto.randomUUID();
            // Only a few example screens are needed for consistency; capping the
            // count (and each excerpt) keeps this prompt bounded regardless of how
            // large the project grows.
            const existing = body.project.screens
              .slice(0, 4)
              .map((screen, idx) => `${idx + 1}. ${screen.name}: ${screen.html.slice(0, 1000)}`)
              .join("\n\n");
            const prompt = `App: ${body.project.name} (${body.project.platform})\nIdea: ${body.project.idea}\n\nNew screen name: ${name}\nPurpose: ${body.purpose?.trim() || "Match the product flow and fill an obvious missing screen."}\nScreen id: ${id}\n\nExisting screens for consistency:\n${existing}\n\nShared design system CSS you MUST use:\n${body.project.designSystemCss}`;
            const result = await runModel(model, systemExtraScreen(), prompt, {
              maxOutputTokens: MAX_TOKENS.screen,
              abortSignal: request.signal,
            });
            return Response.json({
              screen: {
                id,
                name,
                role: body.purpose?.trim() || name,
                html: extractHtml(result.text),
              },
            });
          }

          if (body.mode === "generate-plan") {
            const idea = body.idea?.trim() || "A modern mobile app";
            const platform = body.platform ?? "ios";
            const screenCount = normalizeScreenCount(body.screenCount);
            const phase1Prompt = screenCount
              ? `App idea: ${idea}\nTarget platform: ${platform}\n\nThe user selected exactly ${screenCount} screen(s). Return exactly ${screenCount} screens. Choose the best screen types for the app idea.`
              : `App idea: ${idea}\nTarget platform: ${platform}`;
            const p1res = await runModel(model, systemPhase1(screenCount), phase1Prompt, {
              maxOutputTokens: MAX_TOKENS.plan,
              abortSignal: request.signal,
            });
            const plan = extractJson(p1res.text) as Phase1;
            if (
              !plan?.designSystemCss ||
              !Array.isArray(plan.screens) ||
              plan.screens.length === 0
            ) {
              return Response.json(
                { error: "Planning output invalid", raw: p1res.text.slice(0, 500) },
                { status: 502 },
              );
            }
            plan.screens = coercePlanScreensToCount(plan.screens, screenCount);
            return Response.json({
              plan,
              usage: { mode: "generate-plan", calls: 1, ...p1res.usage },
            });
          }

          if (body.mode === "generate-screen") {
            if (!body.plan || typeof body.screenIndex !== "number") {
              return Response.json(
                { error: "generate-screen requires plan + screenIndex" },
                { status: 400 },
              );
            }
            const screen = body.plan.screens[body.screenIndex];
            if (!screen)
              return Response.json({ error: "Screen index is out of range" }, { status: 400 });
            const idea = body.idea?.trim() || "A modern mobile app";
            const others = body.plan.screens
              .map((x, idx) => `${idx + 1}. ${x.name} — ${x.role}`)
              .join("\n");
            const prompt = `App: ${body.plan.name} (${body.plan.platform})\nIdea: ${idea}\n\nAll screens in this app:\n${others}\n\nGenerate screen #${body.screenIndex + 1}: "${screen.name}" (role: ${screen.role}, id: ${screen.id}).\n\nDesign system CSS you MUST use:\n${body.plan.designSystemCss}`;
            const result = await runModel(model, systemPhase2(), prompt, {
              maxOutputTokens: MAX_TOKENS.screen,
              abortSignal: request.signal,
            });
            return Response.json({
              screen: { ...screen, html: extractHtml(result.text) },
              usage: { mode: "generate-screen", calls: 1, ...result.usage },
            });
          }

          // Website imports: the full page is far too large for a model call,
          // so AI edits are scoped to one selected element.
          if (body.mode === "refine-element") {
            if (!body.elementHtml || !body.instruction) {
              return Response.json(
                { error: "refine-element requires elementHtml + instruction" },
                { status: 400 },
              );
            }
            const system = `You edit ONE HTML element from a captured web page. Return ONLY the updated element's HTML (no JSON, no code fences, no prose).
Rules:
- Keep the SAME outer tag and preserve every data-mae-id attribute exactly as given (including on descendants).
- Make ONLY the change the user asked for; keep all other attributes, classes, inline styles and children as-is.
- Do not add <script>, <iframe>, <form> or external resources.`;
            const prompt = `Page: ${body.projectContext?.name ?? ""}\n\nInstruction:\n${body.instruction}\n\nElement HTML:\n${body.elementHtml}`;
            const { text, usage } = await runModel(model, system, prompt, {
              maxOutputTokens: MAX_TOKENS.refine,
              abortSignal: request.signal,
            });
            console.log(
              `[token-usage] refine-element | input=${usage.input} output=${usage.output} total=${usage.total}`,
            );
            return Response.json({
              html: extractHtml(text),
              usage: { mode: "refine-element", calls: 1, ...usage },
            });
          }

          if (body.mode === "refine") {
            if (!body.screenHtml || !body.instruction) {
              return Response.json(
                { error: "refine requires screenHtml + instruction" },
                { status: 400 },
              );
            }
            const system = `You edit ONE mobile app screen represented as an HTML fragment. Return ONLY the updated HTML fragment (no JSON, no code fences, no prose).
Preserve the outer <div class="screen" data-screen-id="..."> wrapper.
Keep using the provided design-system CSS variables/classes; do not redefine tokens.
Make ONLY the change the user asked for; leave the rest as-is.`;
            const prompt = `Design system CSS (context, do not modify):\n${body.designSystemCss ?? ""}\n\nApp: ${body.projectContext?.name ?? ""} (${body.projectContext?.platform ?? "ios"})\n\nInstruction:\n${body.instruction}\n\nCurrent screen HTML:\n${body.screenHtml}`;
            const { text, usage } = await runModel(model, system, prompt, {
              maxOutputTokens: MAX_TOKENS.refine,
              abortSignal: request.signal,
            });
            console.log(
              `[token-usage] refine  | input=${usage.input} output=${usage.output} total=${usage.total}`,
            );
            return Response.json({
              html: extractHtml(text),
              usage: { mode: "refine", calls: 1, ...usage },
            });
          }

          // generate
          const idea = body.idea?.trim() || "A modern mobile app";
          const platform = body.platform ?? "ios";
          const screenCount = normalizeScreenCount(body.screenCount);

          // Phase 1: shared design system + screen manifest
          const phase1Prompt = screenCount
            ? `App idea: ${idea}\nTarget platform: ${platform}\n\nThe user selected exactly ${screenCount} screen(s). Return exactly ${screenCount} screens. Choose the best screen types for the app idea.`
            : `App idea: ${idea}\nTarget platform: ${platform}`;
          const p1res = await runModel(model, systemPhase1(screenCount), phase1Prompt, {
            maxOutputTokens: MAX_TOKENS.plan,
            abortSignal: request.signal,
          });
          const p1raw = p1res.text;
          const p1 = extractJson(p1raw) as Phase1;
          if (!p1?.designSystemCss || !Array.isArray(p1.screens) || p1.screens.length === 0) {
            return Response.json(
              { error: "Phase 1 output invalid", raw: p1raw.slice(0, 500) },
              { status: 502 },
            );
          }
          p1.screens = coercePlanScreensToCount(p1.screens, screenCount);

          // Phase 2: per-screen HTML, actually in parallel (bounded concurrency).
          const p2others = p1.screens
            .map((x, idx) => `${idx + 1}. ${x.name} — ${x.role}`)
            .join("\n");
          const screensRaw = await mapWithConcurrency(
            p1.screens,
            SCREEN_CONCURRENCY,
            async (s, i) => {
              const prompt = `App: ${p1.name} (${p1.platform})\nIdea: ${idea}\n\nAll screens in this app:\n${p2others}\n\nGenerate screen #${i + 1}: "${s.name}" (role: ${s.role}, id: ${s.id}).\n\nDesign system CSS you MUST use:\n${p1.designSystemCss}`;
              const r2 = await runModel(model, systemPhase2(), prompt, {
                maxOutputTokens: MAX_TOKENS.screen,
                abortSignal: request.signal,
              });
              return {
                id: s.id,
                name: s.name,
                role: s.role,
                html: extractHtml(r2.text),
                usage: r2.usage,
              };
            },
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
            return Response.json(
              { error: "Model output failed validation", details: parsed.error.flatten() },
              { status: 502 },
            );
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
