import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Globe, Loader2, PenTool, X } from "lucide-react";
import { toast } from "sonner";
import { buildWebsiteProject, type EditableArtifact } from "@/lib/import-website";
import { saveProject } from "@/lib/project-store";

type JobState = {
  jobId: string;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  message: string | null;
  url: string | null;
  downloadReady?: boolean;
  editableReady?: boolean;
  editableSize?: number | null;
};

/**
 * "Clone a website" flow on the Home page:
 *   URL → engine job (via /api/clone proxy) → live progress →
 *   two options: Download Website (interactive ZIP, JS intact) or
 *   Edit Design (JS-free editable version opened in the canvas editor).
 */
export default function CloneWebsite({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<JobState | null>(null);
  const [starting, setStarting] = useState(false);
  const [importing, setImporting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stopPolling, []);

  async function start() {
    const target = url.trim();
    if (!target) return;
    setStarting(true);
    setJob(null);
    try {
      const res = await fetch("/api/clone/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId) throw new Error(data.error || `HTTP ${res.status}`);
      setJob({ jobId: data.jobId, status: "pending", progress: 0, message: "Job queued...", url: target });
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/clone/${data.jobId}/status`);
          if (!r.ok) return;
          const s = (await r.json()) as JobState;
          setJob(s);
          if (s.status === "done" || s.status === "error") stopPolling();
        } catch {
          /* transient poll failure — keep polling */
        }
      }, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Clone failed to start: ${message}`);
    } finally {
      setStarting(false);
    }
  }

  async function editDesign() {
    if (!job) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/clone/${job.jobId}/editable`);
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(e?.error || `HTTP ${res.status}`);
      }
      const editable = (await res.json()) as EditableArtifact;
      const project = buildWebsiteProject(editable);
      saveProject(project);
      // IndexedDB write is async fire-and-forget — give it a beat before nav.
      await new Promise((r) => setTimeout(r, 250));
      toast.success(`Imported ${project.name} — opening editor`);
      onOpenProject(project.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Import failed: ${message}`);
    } finally {
      setImporting(false);
    }
  }

  const busy = job && (job.status === "pending" || job.status === "running");

  return (
    <div data-testid="clone-website-panel">
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface/60 p-2 pl-4">
        <Globe className="h-4 w-4 shrink-0 text-brand" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && !starting) void start();
          }}
          placeholder="https://stripe.com"
          disabled={!!busy || starting}
          className="h-11 w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-60"
          autoComplete="off"
          spellCheck={false}
          data-testid="clone-url-input"
        />
        <button
          onClick={() => void start()}
          disabled={!url.trim() || !!busy || starting}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-8px_rgba(255,120,40,0.8)] transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          data-testid="clone-start-button"
        >
          {starting || busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
          Clone Website
        </button>
      </div>

      {job && (
        <div className="mt-4 rounded-2xl border border-border bg-surface/60 p-4 text-left" data-testid="clone-job-card">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate font-mono text-xs text-muted-foreground">{job.url}</div>
            <div className="shrink-0 text-xs font-semibold">
              {job.status === "error" ? (
                <span className="flex items-center gap-1 text-red-400"><AlertCircle className="h-3.5 w-3.5" /> Failed</span>
              ) : job.status === "done" ? (
                <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Ready</span>
              ) : (
                <span className="flex items-center gap-1 text-brand"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {job.progress}%</span>
              )}
            </div>
          </div>

          {job.status !== "done" && job.status !== "error" && (
            <>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-panel">
                <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${job.progress}%` }} />
              </div>
              <div className="mt-2 truncate text-xs text-muted-foreground">{job.message}</div>
            </>
          )}

          {job.status === "error" && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{job.message}</div>
          )}

          {job.status === "done" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <a
                href={`/api/clone/${job.jobId}/download`}
                download
                className="flex items-center gap-3 rounded-xl border border-border bg-panel/60 p-3.5 text-left transition-colors hover:border-brand/60"
                data-testid="clone-download-button"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-panel"><Download className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Download Website</div>
                  <div className="text-xs text-muted-foreground">Interactive ZIP — JS, animations & navigation intact</div>
                </div>
              </a>
              <button
                onClick={() => void editDesign()}
                disabled={importing || !job.editableReady}
                className="flex items-center gap-3 rounded-xl border border-brand/40 bg-gradient-to-b from-brand/10 to-transparent p-3.5 text-left transition-colors hover:border-brand/70 disabled:opacity-50"
                data-testid="clone-edit-button"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-panel">
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenTool className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Edit Design</div>
                  <div className="text-xs text-muted-foreground">
                    Open in the canvas editor{job.editableSize ? ` · ${(job.editableSize / 1024).toFixed(0)} KB` : ""}
                  </div>
                </div>
              </button>
            </div>
          )}

          <button
            onClick={() => { stopPolling(); setJob(null); }}
            className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Dismiss clone job"
          >
            <X className="h-3 w-3" /> Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
