import type { Project } from "@/lib/screen-schema";

/**
 * Realistic, nontrivial fixtures. Each stresses a specific fidelity risk the
 * converters must survive. Screen HTML here is pre-ensureIds (tests apply the
 * canonical sanitize+id pass, exactly like every real entry path).
 */

export const DESIGN_CSS = `:root { --bg: #f6f7fb; --surface: #ffffff; --text: #10131a; --muted: #6b7280; --accent: #6d5ef2; --accent-text: #ffffff; }
.screen { width: 375px; min-height: 812px; background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; }
.ds-card { background: var(--surface); border-radius: 16px; padding: 16px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
.ds-btn { display: flex; align-items: center; justify-content: center; height: 48px; border-radius: 12px; background: var(--accent); color: var(--accent-text); font-weight: 600; }
.ds-tabbar { display: flex; justify-content: space-around; padding: 10px 8px 24px; background: var(--surface); border-top: 1px solid rgba(16, 19, 26, 0.06); }
@font-face { font-family: "Sora"; font-weight: 700; src: url(https://fonts.example/sora-700.woff2) format("woff2"); }
`;

export const APP_HOME_HTML = `<div class="screen" style="display:flex;flex-direction:column;gap:16px;padding:24px 20px 96px">
  <header style="display:flex;align-items:center;justify-content:space-between">
    <h1 style="margin:0;font-size:28px;font-weight:700;letter-spacing:-0.02em">Portfolio</h1>
    <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%236d5ef2'/%3E%3C/svg%3E" alt="avatar" style="width:40px;height:40px;border-radius:50%" />
  </header>
  <section class="ds-card" style="display:flex;flex-direction:column;gap:8px">
    <span style="color:var(--muted);font-size:13px">Total balance</span>
    <strong style="font-size:34px;font-weight:700">$24,082.11</strong>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="ds-btn" data-nav-to="detail" style="flex:1">Invest</button>
      <button class="ds-btn" style="flex:1;background:rgba(109,94,242,0.12);color:var(--accent)">Withdraw</button>
    </div>
  </section>
  <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px">
    <li class="ds-card" style="display:flex;align-items:center;gap:12px"><span style="flex:1">NVDA · 12 shares</span><span style="color:#16a34a;font-weight:600">+4.2%</span></li>
    <li class="ds-card" style="display:flex;align-items:center;gap:12px"><span style="flex:1">AAPL · 30 shares</span><span style="color:#dc2626;font-weight:600">-1.1%</span></li>
  </ul>
  <nav class="ds-tabbar" style="position:absolute;left:0;right:0;bottom:0">
    <span style="color:var(--accent);font-weight:600">Home</span>
    <span data-nav-to="detail" style="color:var(--muted)">Markets</span>
    <span style="color:var(--muted)">Profile</span>
  </nav>
</div>`;

export const APP_DETAIL_HTML = `<div class="screen" style="padding:24px 20px;display:flex;flex-direction:column;gap:14px">
  <button data-nav-to="home" data-nav-animation="slide" data-nav-duration="240" style="width:40px;height:40px;border-radius:12px;border:1px solid rgba(16,19,26,0.08);background:var(--surface)">←</button>
  <h2 style="margin:0;font-size:24px;font-weight:700">NVIDIA Corp.</h2>
  <div class="ds-card" style="height:180px;display:flex;align-items:flex-end;gap:6px;padding:20px">
    <div style="flex:1;height:40%;background:var(--accent);border-radius:4px;opacity:0.35"></div>
    <div style="flex:1;height:65%;background:var(--accent);border-radius:4px;opacity:0.55"></div>
    <div style="flex:1;height:52%;background:var(--accent);border-radius:4px;opacity:0.45"></div>
    <div style="flex:1;height:88%;background:var(--accent);border-radius:4px"></div>
  </div>
  <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)">Amount
    <input type="text" value="1,500" placeholder="0.00" style="height:48px;border-radius:12px;border:1px solid rgba(16,19,26,0.12);padding:0 14px;font-size:16px" />
  </label>
  <button class="ds-btn" data-nav-to="home" data-nav-trigger="press" data-nav-action="navigate">Confirm order</button>
</div>`;

/** Every editor effect type, as effects.js serializes them. */
export const EFFECTS_HTML = `<div class="screen" style="position:relative;padding:24px">
  <div data-mae-type="rect" data-mae-effects='[{"id":"fx-a1","type":"drop-shadow","enabled":true,"x":0,"y":8,"blur":24,"spread":0,"color":"#000000","opacity":30},{"id":"fx-a2","type":"inner-shadow","enabled":true,"x":0,"y":2,"blur":8,"spread":0,"color":"#6d5ef2","opacity":40}]' style="width:200px;height:120px;border-radius:20px;background:#ffffff;box-shadow:0px 8px 24px 0px rgba(0,0,0,0.300), inset 0px 2px 8px 0px rgba(109,94,242,0.400)"></div>
  <div data-mae-type="frame" data-mae-effects='[{"id":"fx-b1","type":"glass","enabled":true,"blur":16,"transparency":18,"borderOpacity":45,"saturation":160,"reflection":35}]' style="position:absolute;left:40px;top:60px;width:220px;height:140px;border-radius:24px;backdrop-filter:blur(16px) saturate(160%)"></div>
  <div data-mae-type="rect" data-mae-effects='[{"id":"fx-c1","type":"layer-blur","enabled":true,"blur":6},{"id":"fx-c2","type":"background-blur","enabled":false,"blur":12,"transparency":60}]' style="width:120px;height:80px;background:#6d5ef2;filter:blur(6px)"></div>
  <div data-mae-type="rect" data-mae-effects='[{"id":"fx-d1","type":"noise","enabled":true,"intensity":50,"scale":2,"opacity":20},{"id":"fx-d2","type":"texture","enabled":true,"pattern":"dots","scale":6,"opacity":15}]' data-mae-fx-bg="linear-gradient(135deg,#6d5ef2,#a78bfa)" style="width:160px;height:100px;background-image:url(&quot;data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='140'%20height='140'%3E%3C/svg%3E&quot;), linear-gradient(135deg,#6d5ef2,#a78bfa)"></div>
</div>`;

/** Editor-drawn absolutely-positioned primitives with mae position model. */
export const CANVAS_PRIMITIVES_HTML = `<div class="screen" style="position:relative">
  <div data-mae-type="text" data-mae-x="32" data-mae-y="48" data-mae-textstyle="ts-hero" style="position:absolute;transform:translate(32px, 48px);font-size:24px;color:#111111;font-family:Sora, Inter, sans-serif;font-weight:700;line-height:32px;letter-spacing:-0.5px">Design anything</div>
  <div data-mae-type="rect" data-mae-x="20" data-mae-y="120" data-mae-flip-x="1" style="position:absolute;transform:translate(20px, 120px) scaleX(-1);width:160px;height:90px;background-color:#6d5ef2;border-radius:14px"></div>
  <div data-mae-type="ellipse" data-mae-x="220" data-mae-y="140" style="position:absolute;transform:translate(220px, 140px);width:72px;height:72px;background-color:#fbbf24;border-radius:50%"></div>
  <img data-mae-type="image" data-mae-x="40" data-mae-y="260" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iODAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iODAiIGZpbGw9IiNlNWU3ZWIiLz48L3N2Zz4=" alt="placeholder" style="position:absolute;transform:translate(40px, 260px);width:120px;height:80px;object-fit:cover" />
</div>`;

export const SVG_HEAVY_HTML = `<div class="screen" style="padding:24px;display:flex;flex-direction:column;gap:16px">
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#6d5ef2"/><stop offset="100%" stop-color="#22d3ee"/></linearGradient></defs>
    <circle cx="60" cy="60" r="50" fill="url(#g1)"/>
    <g stroke="#ffffff" stroke-width="6" stroke-linecap="round"><path d="M38 62 L54 78 L84 44"/></g>
  </svg>
  <p style="margin:0;font-size:15px;color:#6b7280">Payment confirmed. Your receipt is on the way.</p>
  <svg width="343" height="60" viewBox="0 0 343 60" xmlns="http://www.w3.org/2000/svg"><polyline points="0,50 40,42 80,45 120,30 160,34 200,18 240,24 280,10 343,14" fill="none" stroke="#16a34a" stroke-width="2.5"/></svg>
</div>`;

/** Metacharacters and traps for every downstream target. */
export const EDGE_CASES_HTML = `<div class="screen" style="padding:20px;display:flex;flex-direction:column;gap:12px">
  <p style="font-size:14px">Use {{handlebars}} and {tokens} literally, plus @if and @for as text.</p>
  <p style="font-size:14px">5 &lt; 10 &amp;&amp; 12 &gt; 3 — "quoted" &amp; 'single' &amp; back\`tick\` &amp; \${expr}</p>
  <div style="width:100%;height:60px;background-image:url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2720%27%20height=%2720%27%3E%3Ccircle%20cx=%2710%27%20cy=%2710%27%20r=%272%27%20fill=%27%23cbd5e1%27/%3E%3C/svg%3E);background-color:#f8fafc !important;border:1px dashed #cbd5e1"></div>
  <input type="checkbox" checked style="width:20px;height:20px" />
  <select style="height:40px"><option>Alpha</option><option selected>Beta</option></select>
  <p data-note="a &quot;quoted&quot; attr with < and {{

}}" style="font-size:12px;color:#94a3b8">meta test</p>
  <div style="--card-pad: 12px; padding: var(--card-pad); background: #fff">custom property padding</div>
</div>`;

/** Website-clone shape: .screen wrapper + embedded <style> + flow layout. */
export const WEBSITE_HTML = `<div class="screen" data-screen-id="home">
  <style>.hero-band { background: linear-gradient(120deg, #0f172a, #312e81); color: #fff; } .hero-band h1 { font-size: clamp(32px, 5vw, 56px); margin: 0 0 12px; } .plan-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }</style>
  <header style="display:flex;align-items:center;justify-content:space-between;padding:20px 48px">
    <strong style="font-size:18px">northwind.io</strong>
    <nav style="display:flex;gap:28px;font-size:14px"><a href="#features" style="color:inherit;text-decoration:none">Features</a><a href="#pricing" style="color:inherit;text-decoration:none">Pricing</a><a href="#docs" style="color:inherit;text-decoration:none">Docs</a></nav>
  </header>
  <section class="hero-band" style="padding:96px 48px;text-align:center">
    <h1>Ship dashboards in minutes</h1>
    <p style="margin:0 auto;max-width:520px;opacity:0.8">Northwind turns your warehouse into live, shareable analytics without a data team.</p>
  </section>
  <section class="plan-grid" style="padding:64px 48px">
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:28px"><h3 style="margin:0 0 6px">Starter</h3><p style="margin:0;color:#64748b">$0 / mo</p></div>
    <div style="border:2px solid #6d5ef2;border-radius:12px;padding:28px"><h3 style="margin:0 0 6px">Growth</h3><p style="margin:0;color:#64748b">$49 / mo</p></div>
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:28px"><h3 style="margin:0 0 6px">Scale</h3><p style="margin:0;color:#64748b">$199 / mo</p></div>
  </section>
</div>`;

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "test-project",
    name: "Fixture App",
    idea: "fixture",
    platform: "ios",
    designSystem: {
      palette: {
        background: "#f6f7fb",
        surface: "#ffffff",
        text: "#10131a",
        muted: "#6b7280",
        accent: "#6d5ef2",
        accentText: "#ffffff",
      },
      radius: "lg",
      font: "Inter",
    },
    designSystemCss: DESIGN_CSS,
    screens: [
      { id: "home", name: "Home", role: "home", html: APP_HOME_HTML },
      { id: "detail", name: "Detail", role: "detail", html: APP_DETAIL_HTML },
    ],
    format_config: { artifactType: "app", frame: { width: 375, height: 812 } },
    ...overrides,
  };
}

export const SCREEN_FIXTURES: Record<string, string> = {
  "app-home": APP_HOME_HTML,
  "app-detail": APP_DETAIL_HTML,
  effects: EFFECTS_HTML,
  "canvas-primitives": CANVAS_PRIMITIVES_HTML,
  "svg-heavy": SVG_HEAVY_HTML,
  "edge-cases": EDGE_CASES_HTML,
  website: WEBSITE_HTML,
};
