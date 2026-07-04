import CloneWebsite from "@/components/CloneWebsite";
import ImportCode from "@/components/ImportCode";
import { PhoneScreenFrame } from "@/components/PhoneScreenFrame";
import { deleteProject, listProjects, type ProjectSummary } from "@/lib/project-store";
import { TEMPLATES } from "@/lib/templates";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Clock, Code2, Globe, Image as ImageIcon, Layers, Send, Sparkle, Sparkles, Trash2, Zap } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function timeAgo(ts: number): string {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Live preview of a saved project's first screen — reuses the real renderer,
// scaled down to fit the card (no image generation needed).
function ProjectThumbnail({ summary }: { summary: ProjectSummary }) {
  const W = 168;
  // Website imports: payloads live in IndexedDB (the summary carries no HTML)
  // and a 1440px-wide page is too heavy for a live card — show a site card.
  if (summary.format_config?.artifactType === "website") {
    let hostname = "website";
    try {
      hostname = new URL(summary.format_config?.source?.url || "").hostname.replace(/^www\./, "");
    } catch { /* keep default */ }
    return (
      <div
        className="pointer-events-none flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-border/70 bg-gradient-to-b from-panel to-surface"
        style={{ width: W, height: Math.round(W * 1.3) }}
        aria-hidden
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15">
          <Globe className="h-6 w-6 text-brand" />
        </div>
        <div className="max-w-[85%] truncate text-center text-[11px] font-semibold text-foreground">{summary.name}</div>
        <div className="max-w-[85%] truncate text-center font-mono text-[9px] text-muted-foreground">{hostname}</div>
        <div className="rounded-full border border-border bg-surface/70 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Website</div>
      </div>
    );
  }
  const scale = W / 375;
  return (
    <div
      className="pointer-events-none overflow-hidden rounded-xl border border-border/70 bg-black"
      style={{ width: W, height: Math.round(812 * scale) }}
      aria-hidden
    >
      <div style={{ width: 375, height: 812, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <PhoneScreenFrame
          platform={summary.platform}
          html={summary.firstScreenHtml}
          css={summary.designSystemCss}
        />
      </div>
    </div>
  );
}

function SavedProjects({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  // localStorage is client-only — read after mount (SSR renders nothing).
  useEffect(() => {
    setProjects(listProjects());
  }, []);

  if (projects.length === 0) return null;

  const remove = (id: string) => {
    deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <section className="relative z-10 mx-auto max-w-7xl px-8 pb-6">
      <div className="mb-6 flex items-center gap-2 text-[15px]">
        <Layers className="h-4 w-4 text-brand" />
        <span className="font-medium">Your projects</span>
        <span className="text-sm text-muted-foreground">· pick up where you left off</span>
      </div>
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {projects.map((p) => (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p.id); }
            }}
            className="group relative flex cursor-pointer flex-col gap-3 rounded-2xl border border-border/70 bg-panel/60 p-3 text-left transition-all hover:border-brand/60 hover:bg-panel"
            data-testid="saved-project-card"
            data-project-id={p.id}
          >
            <div className="flex justify-center">
              <ProjectThumbnail summary={p} />
            </div>
            <div className="px-1 pb-1">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-semibold text-foreground">{p.name}</div>
                <span className="shrink-0 rounded-full border border-border bg-surface/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  {p.format_config?.artifactType === "website" ? "Web" : p.platform === "ios" ? "iOS" : "Android"}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeAgo(p.updatedAt)}
                </span>
                <span className="text-border">·</span>
                <span>{p.screenCount} screen{p.screenCount === 1 ? "" : "s"}</span>
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); remove(p.id); }}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface/90 text-muted-foreground opacity-0 backdrop-blur transition-all hover:text-red-400 group-hover:opacity-100"
              aria-label={`Delete ${p.name}`}
              title="Delete project"
              data-testid="saved-project-delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SleekLogo() {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-brand shadow-[0_0_20px_-2px_var(--brand)]">
        <span className="font-serif text-base font-bold italic leading-none text-white">S</span>
      </div>
      <span className="text-lg font-semibold tracking-tight">sleek<span className="text-muted-foreground">.design</span></span>
    </div>
  );
}

function Landing() {
  const navigate = useNavigate();
  const [idea, setIdea] = useState("");
  const [platform, setPlatform] = useState<"ios" | "android">("ios");
  const [creationMode, setCreationMode] = useState<"app" | "clone" | "import">("app");

  function launch(withIdea: string) {
    if (!withIdea.trim()) return;
    const params = new URLSearchParams({ idea: withIdea, platform });
    navigate({ to: "/workspace", search: () => Object.fromEntries(params) });
  }

  function openProject(id: string) {
    navigate({ to: "/workspace", search: () => ({ project: id }) });
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface text-foreground">
      {/* Warm horizon glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-[62%] h-[520px]"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 0%, rgba(255,110,40,0.55), rgba(255,90,30,0.18) 40%, transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-[62%] h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(255,140,60,0.9), transparent)" }}
      />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-8 py-6">
        <SleekLogo />
        <nav className="hidden items-center gap-8 text-sm text-foreground/85 md:flex">
          <a href="#pricing" className="hover:text-foreground">Pricing</a>
          <button className="flex items-center gap-1 hover:text-foreground">
            Resources <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <a href="#templates" className="hover:text-foreground">App Store Screenshots</a>
          <a href="#blog" className="hover:text-foreground">Blog</a>
        </nav>
        <div className="flex items-center gap-4">
          <button className="text-sm text-foreground/85 hover:text-foreground">Log In</button>
          <button
            onClick={() => launch("A modern productivity app with focus timer, tasks, and calendar")}
            className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_28px_-6px_rgba(255,120,40,0.7)] transition-transform hover:scale-[1.02]"
          >
            Get Started
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-6 pb-20 pt-14">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border/70 bg-panel/60 px-4 py-1.5 text-[13px] font-medium text-foreground/90 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            Claude Code can now design your app with Sleek <span className="text-muted-foreground">→</span>
          </div>
          <h1 className="text-balance text-6xl font-bold leading-[1.02] tracking-tight md:text-[76px]">
            Design mobile apps{" "}
            <span className="text-brand">in&nbsp;minutes</span>{" "}
            <Zap className="inline h-11 w-11 -translate-y-2 fill-brand text-brand md:h-14 md:w-14" />
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-foreground/70">
            Go from idea to beautiful app designs in minutes by chatting with AI.
          </p>

          {/* Prompt box — two entry points: describe an app, or clone a website */}
          <div className="mx-auto mt-12 max-w-3xl rounded-[28px] border border-border/70 bg-panel/70 p-5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur">
            <div className="mb-4 flex items-center justify-center">
              <div className="flex items-center gap-1 rounded-full bg-surface/80 p-1">
                <button
                  onClick={() => setCreationMode("app")}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                    creationMode === "app" ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid="mode-tab-app"
                >
                  <Sparkles className="h-3 w-3" />
                  Design an app
                </button>
                <button
                  onClick={() => setCreationMode("clone")}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                    creationMode === "clone" ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid="mode-tab-clone"
                >
                  <Globe className="h-3 w-3" />
                  Clone a website
                </button>
                <button
                  onClick={() => setCreationMode("import")}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                    creationMode === "import" ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid="mode-tab-import"
                >
                  <Code2 className="h-3 w-3" />
                  Import code
                </button>
              </div>
            </div>

            {creationMode === "clone" ? (
              <CloneWebsite onOpenProject={openProject} />
            ) : creationMode === "import" ? (
              <ImportCode onOpenProject={openProject} />
            ) : (
              <>
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="I want to design an app that..."
                  className="min-h-[110px] w-full resize-none bg-transparent px-1 text-left text-base text-foreground placeholder:text-muted-foreground/80 focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button className="flex h-10 w-10 items-center justify-center rounded-full bg-surface/80 text-muted-foreground transition-colors hover:text-foreground" aria-label="Upload image">
                      <ImageIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setPlatform((p) => (p === "ios" ? "android" : "ios"))}
                      aria-label="Toggle platform"
                      className="flex items-center gap-2 rounded-full bg-surface/80 px-3.5 py-2 text-sm text-foreground/90 transition-colors hover:text-foreground"
                    >
                      <Sparkle className="h-3.5 w-3.5 text-brand" />
                      <span>{platform === "ios" ? "iOS" : "Android"}</span>
                      <ChevronDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <button
                    onClick={() => launch(idea)}
                    disabled={!idea.trim()}
                    className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-8px_rgba(255,120,40,0.8)] transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                  >
                    Design it
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Saved projects — appears only when the user has projects saved locally */}
      <SavedProjects onOpen={openProject} />

      {/* Inspiration */}
      <section id="templates" className="relative z-10 mx-auto max-w-7xl px-8 pb-24">
        <div className="mb-6 flex items-center gap-2 text-[15px]">
          <Sparkles className="h-4 w-4 text-brand" />
          <span className="font-medium">Need inspiration?</span>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TEMPLATES.slice(0, 8).map((t) => (
            <button
              key={t.id}
              onClick={() => launch(t.idea)}
              className="group relative overflow-hidden rounded-2xl border border-border/70 bg-panel/60 p-5 text-left transition-all hover:border-brand/60 hover:bg-panel"
            >
              <div
                className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-30 blur-3xl transition-opacity group-hover:opacity-60"
                style={{ background: t.accent }}
              />
              <div className="relative">
                <div className="text-[15px] font-semibold text-foreground">{t.name}</div>
                <div className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
                  {t.description}
                </div>
                <div
                  className="mt-6 inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: t.accent }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.accent }} />
                  {t.style}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative z-10 mx-auto max-w-5xl px-8 pb-24">
        <div className="mb-10 text-center">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-brand">Pricing</div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Start free. Scale when your team does.</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { name: "Free", price: "$0", perks: ["1 project", "50 AI credits / month", "Export to code"] },
            { name: "Pro", price: "$24", perks: ["Unlimited projects", "2,000 credits / month", "Figma export"], featured: true },
            { name: "Team", price: "$79", perks: ["Everything in Pro", "Team collaboration", "Priority generation"] },
          ].map((t) => (
            <div
              key={t.name}
              className={`rounded-2xl border p-7 ${
                t.featured
                  ? "border-brand/60 bg-gradient-to-b from-brand/10 to-transparent shadow-[0_20px_60px_-30px_rgba(255,110,40,0.8)]"
                  : "border-border bg-panel/50"
              }`}
            >
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>{t.name}</span>
                {t.featured && (
                  <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
                    Popular
                  </span>
                )}
              </div>
              <div className="mt-3 text-4xl font-bold">
                {t.price}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>
              </div>
              <ul className="mt-6 space-y-2.5 text-sm text-muted-foreground">
                {t.perks.map((p) => (
                  <li key={p} className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-brand" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-border py-8 text-center text-xs text-muted-foreground">
        sleek.design · Design mobile apps in minutes
      </footer>
    </div>
  );
}
