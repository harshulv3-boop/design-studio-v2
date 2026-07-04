import { Router } from "express";
import { chromium } from "playwright";
import JSZip from "jszip";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import dns from "dns/promises";
import net from "net";
import { StartCloneBody, GetCloneStatusParams, DownloadCloneParams } from "@workspace/api-zod";
import {
  EDITABLE_CAPTURE_SCRIPT,
  absolutizeCssUrls,
  inlineCssImports,
  minifyCss,
} from "../lib/editable-capture";

const router = Router();

type JobStatus = "pending" | "running" | "done" | "error";

interface Job {
  jobId: string;
  status: JobStatus;
  progress: number;
  message: string | null;
  url: string | null;
  zipPath: string | null;
  tmpDir: string | null;
  /** Editable (JS-free, canvas-ready) artifact for App Design Studio. */
  editablePath: string | null;
  /** Full-page reference screenshot for fidelity QA. */
  screenshotPath: string | null;
  editableSize: number | null;
}

const jobs = new Map<string, Job>();

/** Cleanup job artifacts from disk */
function cleanupJob(job: Job) {
  if (job.tmpDir) {
    fs.rm(job.tmpDir, { recursive: true, force: true }, () => {});
  }
}

/** Schedule cleanup after 30 minutes */
function scheduleCleanup(job: Job) {
  setTimeout(() => {
    cleanupJob(job);
    jobs.delete(job.jobId);
  }, 30 * 60 * 1000);
}

/** Private/reserved IP ranges that should not be reachable (SSRF protection) */
const BLOCKED_CIDRS = [
  { start: ipToLong("127.0.0.0"), end: ipToLong("127.255.255.255") },
  { start: ipToLong("10.0.0.0"), end: ipToLong("10.255.255.255") },
  { start: ipToLong("172.16.0.0"), end: ipToLong("172.31.255.255") },
  { start: ipToLong("192.168.0.0"), end: ipToLong("192.168.255.255") },
  { start: ipToLong("169.254.0.0"), end: ipToLong("169.254.255.255") },
  { start: ipToLong("169.254.169.254"), end: ipToLong("169.254.169.254") },
  { start: ipToLong("224.0.0.0"), end: ipToLong("255.255.255.255") },
];

function ipToLong(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + parseInt(part, 10), 0) >>> 0;
}

function isPrivateIp(ip: string): boolean {
  if (!net.isIPv4(ip)) return true; // block IPv6 for now
  const long = ipToLong(ip);
  return BLOCKED_CIDRS.some((r) => long >= r.start && long <= r.end);
}

async function assertSafeUrl(urlStr: string): Promise<void> {
  const parsed = new URL(urlStr);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  // Dev-only escape hatch so a locally-served benchmark page can be cloned
  // (e.g. sandboxed CI without public egress). NEVER set in production.
  if (process.env.CLONE_ALLOW_LOCAL === "1") return;
  const hostname = parsed.hostname;
  let addresses: string[] = [];
  // Resolve the host to IPv4 addresses for the SSRF check. Prefer dns.resolve4
  // (direct A-record query), but fall back to dns.lookup — the OS resolver the
  // browser itself uses — because resolve4 frequently fails on corporate
  // networks, VPNs, or DNS-over-HTTPS setups even when normal browsing works.
  try {
    addresses = await dns.resolve4(hostname);
  } catch {
    try {
      const looked = await dns.lookup(hostname, { all: true, family: 4 });
      addresses = looked.map((r) => r.address);
    } catch {
      addresses = [];
    }
  }
  if (addresses.length === 0) {
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new Error("URL resolves to a private/reserved IP address — not allowed");
    }
  }
}

// U+2028/U+2029 are legal in JSON but are line terminators in JS source —
// they must be escaped before a JSON payload is embedded in an evaluate
// script. Built from char codes so these characters never appear in THIS
// source file either.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);
function jsSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .split(LINE_SEP)
    .join("\\u2028")
    .split(PARA_SEP)
    .join("\\u2029");
}

async function runClone(job: Job, targetUrl: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siteclone-"));
  job.tmpDir = tmpDir;

  const assetsDir = path.join(tmpDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  job.status = "running";
  job.message = "Launching browser...";
  job.progress = 5;

  let browser;
  try {
    // Optional override: point at a specific Chromium binary (Docker images,
    // AWS Lambda layers, or any environment where `playwright install` isn't
    // used). Default: Playwright's managed browser. Set CLONE_CHROMIUM_ARGS
    // (comma-separated) for sandbox flags like --no-sandbox when required.
    const execPath = process.env.CLONE_CHROMIUM_PATH || undefined;
    const extraArgs = (process.env.CLONE_CHROMIUM_ARGS || "").split(",").map((a) => a.trim()).filter(Boolean);
    // Anti-bot-detection ("stealth"). Many sites serve an error/challenge page
    // to headless browsers; the biggest tell is the automation flag, which this
    // arg + the init script below hide. This is best-effort — it unblocks a lot
    // of ordinary bot-protected sites, but not those with advanced fingerprinting
    // (some Meta properties, Cloudflare hard challenges) which may still error.
    browser = await chromium.launch({
      headless: true,
      executablePath: execPath,
      args: ["--disable-blink-features=AutomationControlled", ...extraArgs],
    });
    const UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    const context = await browser.newContext({
      viewport: { width: 1536, height: 960 },
      userAgent: UA,
      locale: "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Upgrade-Insecure-Requests": "1",
      },
    });
    // Patch the runtime fingerprints headless Chrome gives away, on every frame.
    await context.addInitScript(() => {
      try { Object.defineProperty(navigator, "webdriver", { get: () => false }); } catch { /* ignore */ }
      try { Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] }); } catch { /* ignore */ }
      try { Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] }); } catch { /* ignore */ }
      try { (window as unknown as { chrome?: unknown }).chrome ??= { runtime: {} }; } catch { /* ignore */ }
      try {
        const perms = navigator.permissions;
        if (perms && perms.query) {
          const original = perms.query.bind(perms);
          perms.query = (desc: PermissionDescriptor) =>
            desc && desc.name === "notifications"
              ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
              : original(desc);
        }
      } catch { /* ignore */ }
    });

    // Intercept and capture all resources (acao retained so the editable
    // artifact can decide which fonts must be inlined as data URIs — cross-
    // origin font loading in the studio canvas requires permissive CORS).
    const capturedResources = new Map<
      string,
      { contentType: string; body: Buffer; acao: string | null }
    >();

    await context.route("**/*", async (route) => {
      try {
        const response = await route.fetch();
        const body = await response.body();
        const headers = response.headers();
        const contentType = headers["content-type"] || "";
        const acao = headers["access-control-allow-origin"] ?? null;
        capturedResources.set(route.request().url(), { contentType, body, acao });
        await route.fulfill({ response });
      } catch {
        await route.continue();
      }
    });

    const page = await context.newPage();

    job.message = "Navigating to page...";
    job.progress = 10;

    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch {
      job.message = "Initial navigation done, continuing...";
    }

    job.message = "Waiting for page to settle...";
    job.progress = 20;

    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      // timeout is acceptable
    }

    job.message = "Scrolling to trigger lazy-loaded content...";
    job.progress = 30;

    // Auto-scroll full page to trigger lazy loading (string form avoids server-side DOM TS errors)
    await page.evaluate(`
      new Promise((resolve) => {
        const scrollStep = 300;
        const scrollDelay = 120;
        let currentY = 0;
        const maxY = document.documentElement.scrollHeight;
        const scroll = () => {
          currentY += scrollStep;
          window.scrollTo(0, currentY);
          if (currentY < maxY) {
            setTimeout(scroll, scrollDelay);
          } else {
            window.scrollTo(0, 0);
            resolve();
          }
        };
        scroll();
      })
    `);

    try {
      await page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch {
      // ignore
    }

    job.message = "Capturing page content...";
    job.progress = 50;

    const rawHtml = await page.content();

    // ---------------------------------------------------------------------
    // Editable artifact (App Design Studio "Edit Design" path) + reference
    // screenshot. Additive: any failure here is recorded and the classic ZIP
    // flow below continues untouched.
    // ---------------------------------------------------------------------
    try {
      job.message = "Capturing reference screenshot...";
      job.progress = 52;
      const screenshotPath = path.join(tmpDir, "reference.png");
      await page.screenshot({ path: screenshotPath, fullPage: true });
      job.screenshotPath = screenshotPath;

      job.message = "Building editable version...";
      job.progress = 56;

      // CSS sources: every captured stylesheet, refs absolutized against the
      // sheet's own URL, @imports inlined from the capture set.
      const rawCssByUrl = new Map<string, string>();
      for (const [resUrl, res] of capturedResources) {
        if (res.contentType.includes("text/css")) {
          rawCssByUrl.set(resUrl, res.body.toString("utf8"));
        }
      }
      const cssSources: { url: string; text: string }[] = [];
      for (const [sheetUrl, text] of rawCssByUrl) {
        cssSources.push({
          url: sheetUrl,
          text: inlineCssImports(
            absolutizeCssUrls(text, sheetUrl),
            sheetUrl,
            rawCssByUrl,
          ),
        });
      }

      const evalPayload = jsSafeJson({ cssSources, pageUrl: targetUrl });
      const captured = (await page.evaluate(
        `(${EDITABLE_CAPTURE_SCRIPT})(${evalPayload})`,
      )) as {
        html: string;
        css: string;
        title: string;
        pageHeight: number;
        stats: { kept: number; shaken: number };
        warnings: string[];
      };

      // Fonts: keep absolute URLs when the origin sent permissive CORS
      // (cross-origin @font-face needs it inside the studio); otherwise inline
      // as data URIs (≤300 KB each) so text never falls back to a wrong font.
      let css = captured.css;
      const fontRefs = [...css.matchAll(/url\("(https?:\/\/[^"]+\.(?:woff2?|ttf|otf))(?:[?#][^"]*)?"\)/gi)];
      const seen = new Set<string>();
      for (const m of fontRefs) {
        const fullUrl = m[1]!;
        if (seen.has(fullUrl)) continue;
        seen.add(fullUrl);
        const res = capturedResources.get(fullUrl);
        if (!res) continue;
        const permissive = res.acao === "*" || res.acao === new URL(targetUrl).origin;
        if (permissive) continue;
        if (res.body.length > 300 * 1024) {
          captured.warnings.push(`font too large to inline, may not render cross-origin: ${fullUrl}`);
          continue;
        }
        const mime = fullUrl.endsWith(".woff2") ? "font/woff2" : fullUrl.endsWith(".woff") ? "font/woff" : "font/ttf";
        css = css.split(`url("${fullUrl}")`).join(`url("data:${mime};base64,${res.body.toString("base64")}")`);
      }

      css = minifyCss(css);
      const editable = {
        sourceUrl: targetUrl,
        title: captured.title,
        frameWidth: 1536,
        pageHeight: captured.pageHeight,
        html: captured.html,
        css,
        warnings: captured.warnings,
        stats: captured.stats,
        capturedAt: Date.now(),
      };
      const editableJson = JSON.stringify(editable);
      const editablePath = path.join(tmpDir, "editable.json");
      fs.writeFileSync(editablePath, editableJson);
      job.editablePath = editablePath;
      job.editableSize = Buffer.byteLength(editableJson);
      if (job.editableSize > 1024 * 1024) {
        // Fidelity-first policy: never degrade visuals to hit the budget —
        // surface the overage so it shows up in QA instead.
        captured.warnings.push(`editable payload ${(job.editableSize / 1024).toFixed(0)} KB exceeds 1 MB target`);
      }
    } catch (err) {
      job.editablePath = null;
      job.screenshotPath = null;
      // Editable capture must never fail the classic clone.
      console.error("editable capture failed", err);
    }

    job.message = "Processing and inlining resources...";
    job.progress = 60;

    const assetMap = new Map<string, string>();
    let assetIndex = 0;

    for (const [url, { contentType, body }] of capturedResources) {
      if (body.length === 0) continue;

      let ext = "";
      if (contentType.includes("text/css")) ext = ".css";
      else if (contentType.includes("javascript")) ext = ".js";
      else if (contentType.includes("image/svg+xml")) ext = ".svg";
      else if (contentType.includes("image/png")) ext = ".png";
      else if (contentType.includes("image/jpeg") || contentType.includes("image/jpg")) ext = ".jpg";
      else if (contentType.includes("image/webp")) ext = ".webp";
      else if (contentType.includes("image/gif")) ext = ".gif";
      else if (contentType.includes("image/avif")) ext = ".avif";
      else if (contentType.includes("font/woff2") || url.includes(".woff2")) ext = ".woff2";
      else if (contentType.includes("font/woff") || url.includes(".woff")) ext = ".woff";
      else if (contentType.includes("font/ttf") || url.includes(".ttf")) ext = ".ttf";
      else continue;

      const filename = `asset_${assetIndex++}${ext}`;
      fs.writeFileSync(path.join(assetsDir, filename), body);
      assetMap.set(url, `assets/${filename}`);
    }

    job.message = "Rewriting URLs in HTML...";
    job.progress = 70;

    // Make the downloaded page actually work on ANY site. Most sites reference
    // CSS/JS/images with relative or root-relative paths (href="/_next/app.css",
    // src="./bundle.js"); the old approach only string-replaced fully-qualified
    // URLs, so those refs were never rewritten and the page loaded with no CSS
    // or JS. A single <base href="origin/"> resolves every relative URL back to
    // the live origin at once — stylesheets, scripts, fonts, images, and the
    // page's own fetch()/navigation — keeping JS and interactivity intact for
    // every site, not just ones that happen to use absolute URLs.
    let processedHtml = rawHtml;
    const origin = new URL(targetUrl).origin + "/";
    const baseTag = `<base href="${origin}">`;
    // Drop any pre-existing <base> (it would override ours), then insert ours
    // as the first thing in <head> so it applies before any resource ref.
    processedHtml = processedHtml.replace(/<base\b[^>]*>/gi, "");
    if (/<head[^>]*>/i.test(processedHtml)) {
      processedHtml = processedHtml.replace(/<head[^>]*>/i, (m) => m + "\n    " + baseTag);
    } else if (/<html[^>]*>/i.test(processedHtml)) {
      processedHtml = processedHtml.replace(/<html[^>]*>/i, (m) => m + "<head>" + baseTag + "</head>");
    } else {
      processedHtml = baseTag + processedHtml;
    }

    job.message = "Creating zip archive...";
    job.progress = 80;

    const zip = new JSZip();
    zip.file("index.html", processedHtml);
    // README so it's clear the page streams its assets from the origin.
    zip.file(
      "README.txt",
      `Cloned from ${targetUrl}\n\n` +
        `index.html renders the captured page and loads its CSS/JS/images/fonts\n` +
        `from the original site (via a <base> tag), so JS and interactivity stay\n` +
        `intact. Open it in a browser while online. The /assets folder contains\n` +
        `the resources captured at clone time for reference/offline work.\n`,
    );
    // Still bundle the captured assets for reference / offline tinkering.
    const assetsFolder = zip.folder("assets")!;
    const assetFiles = fs.readdirSync(assetsDir);
    for (const filename of assetFiles) {
      const fileBuf = fs.readFileSync(path.join(assetsDir, filename));
      assetsFolder.file(filename, fileBuf);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const zipPath = path.join(tmpDir, "clone.zip");
    fs.writeFileSync(zipPath, zipBuffer);

    job.zipPath = zipPath;
    job.status = "done";
    job.progress = 100;
    job.message = `Clone complete! Captured ${assetMap.size} assets.`;

    scheduleCleanup(job);
  } catch (err) {
    job.status = "error";
    job.message = `Error: ${err instanceof Error ? err.message : String(err)}`;
    cleanupJob(job);
    scheduleCleanup(job);
    throw err;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// POST /clone/start
router.post("/clone/start", async (req, res) => {
  const parsed = StartCloneBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body: url is required" });
    return;
  }

  let { url } = parsed.data;

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL provided" });
    return;
  }

  // SSRF protection: resolve and block private/internal IPs
  try {
    await assertSafeUrl(url);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "URL not allowed" });
    return;
  }

  const jobId = crypto.randomUUID();
  const job: Job = {
    jobId,
    status: "pending",
    progress: 0,
    message: "Job queued...",
    url,
    zipPath: null,
    tmpDir: null,
    editablePath: null,
    screenshotPath: null,
    editableSize: null,
  };
  jobs.set(jobId, job);

  runClone(job, url).catch((err) => {
    req.log.error({ err, jobId }, "Clone job failed");
  });

  res.status(201).json({ jobId, status: "pending" });
});

// GET /clone/:jobId/status
router.get("/clone/:jobId/status", (req, res) => {
  const parsed = GetCloneStatusParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const job = jobs.get(parsed.data.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    url: job.url,
    downloadReady: job.status === "done" && job.zipPath != null,
    editableReady: job.status === "done" && job.editablePath != null,
    editableSize: job.editableSize,
  });
});

// GET /clone/:jobId/editable — the JS-free, canvas-ready artifact consumed by
// App Design Studio's "Edit Design" flow.
router.get("/clone/:jobId/editable", (req, res) => {
  const parsed = GetCloneStatusParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }
  const job = jobs.get(parsed.data.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "done" || !job.editablePath || !fs.existsSync(job.editablePath)) {
    res.status(404).json({ error: "Editable version not available" });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  fs.createReadStream(job.editablePath).pipe(res);
});

// GET /clone/:jobId/screenshot — full-page reference screenshot (fidelity QA).
router.get("/clone/:jobId/screenshot", (req, res) => {
  const parsed = GetCloneStatusParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }
  const job = jobs.get(parsed.data.jobId);
  if (!job || !job.screenshotPath || !fs.existsSync(job.screenshotPath)) {
    res.status(404).json({ error: "Screenshot not available" });
    return;
  }
  res.setHeader("Content-Type", "image/png");
  fs.createReadStream(job.screenshotPath).pipe(res);
});

// GET /clone/:jobId/download
router.get("/clone/:jobId/download", (req, res) => {
  const parsed = DownloadCloneParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const job = jobs.get(parsed.data.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "done" || !job.zipPath) {
    res.status(404).json({ error: "Clone not ready yet" });
    return;
  }

  if (!fs.existsSync(job.zipPath)) {
    res.status(410).json({ error: "Clone archive has expired" });
    return;
  }

  let hostname = "site";
  try { hostname = new URL(job.url!).hostname; } catch { /* ignore */ }

  const filename = `${hostname}.zip`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/zip");
  fs.createReadStream(job.zipPath).pipe(res);
});

export default router;
