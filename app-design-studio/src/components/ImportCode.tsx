import { useRef, useState } from "react";
import { AlertCircle, Code2, FileUp, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { readProjectArchive } from "@/lib/import-project-archive";
import { saveProject } from "@/lib/project-store";
import {
  LANGUAGES,
  ImportError,
  buildImportedProject,
  detectLanguage,
  languageForFile,
  parseHtmlToArtifact,
  type LanguageId,
} from "@/lib/import-code";

const ACCEPT = [...LANGUAGES.filter((l) => l.available).flatMap((l) => l.exts), ".zip"].join(",");

function guessTitle(code: string, lang: LanguageId, filename?: string): string {
  if (filename) return filename.replace(/\.[^.]+$/, "");
  if (lang === "html") {
    const m = code.match(/<title[^>]*>([^<]+)<\/title>/i) || code.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (m) return m[1].trim().slice(0, 60);
    return "Imported HTML";
  }
  const c = code.match(/(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/);
  return c ? c[1] : "Imported Component";
}

/**
 * "Import code" flow on the Home page:
 *   paste or upload HTML/CSS or a React (JSX/TSX) component →
 *   HTML is parsed client-side, React is rendered to HTML by /api/import-code →
 *   both build a canvas Project through the same buildImportedProject path and
 *   open in the editor. Same sanitize + load pipeline as the url-to-code import.
 */
export default function ImportCode({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [code, setCode] = useState("");
  const [lang, setLang] = useState<LanguageId>("html");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [manifestProject, setManifestProject] = useState<Awaited<ReturnType<typeof readProjectArchive>>["project"] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPaste(next: string) {
    setCode(next);
    setError(null);
    setManifestProject(null);
    // Auto-detect only while the user hasn't uploaded a file that fixed the type.
    if (!uploadName && next.trim()) setLang(detectLanguage(next));
  }

  async function onFile(file: File) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      setBusy(true);
      setError(null);
      setWarnings([]);
      try {
        const archive = await readProjectArchive(file);
        setCode(archive.code);
        setUploadName(file.name);
        setLang(archive.language);
        setManifestProject(archive.project ?? null);
        setWarnings(archive.warnings);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(`Import failed: ${message}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      setCode(text);
      setUploadName(file.name);
      setError(null);
      setManifestProject(null);
      const byExt = languageForFile(file.name);
      setLang(byExt ?? detectLanguage(text));
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  async function runImport() {
    const source = code.trim();
    if (!source) return;
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      if (manifestProject) {
        saveProject(manifestProject);
        await new Promise((r) => setTimeout(r, 250));
        toast.success(`Imported ${manifestProject.name} — opening editor`);
        onOpenProject(manifestProject.id);
        return;
      }

      let html: string;
      let css = "";
      const def = LANGUAGES.find((l) => l.id === lang);
      const title = guessTitle(source, lang, uploadName ?? undefined);

      if (def?.kind === "client") {
        // HTML/CSS — parse in the browser, no render step needed.
        const parsed = parseHtmlToArtifact(source);
        html = parsed.html;
        css = parsed.css;
      } else {
        // React (and future server languages) — render to HTML server-side.
        const res = await fetch("/api/import-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: source, language: lang }),
        });
        const data = (await res.json().catch(() => null)) as
          | { html?: string; css?: string; warnings?: string[]; error?: string }
          | null;
        if (!res.ok || !data?.html) {
          throw new ImportError(data?.error || `Import failed (HTTP ${res.status}).`);
        }
        // Rendered React can carry its styling as an inline <style> (e.g. our own
        // TSX export embeds DESIGN_SYSTEM_CSS that way). Run it through the same
        // extractor as the HTML path so the CSS lands in designSystemCss and
        // renders via the reliable scoped-CSS path — not a fragile inline tag.
        const parsed = parseHtmlToArtifact(data.html);
        html = parsed.html;
        css = [data.css, parsed.css].filter(Boolean).join("\n");
        if (data.warnings?.length) setWarnings(data.warnings);
      }

      const project = buildImportedProject({ html, css, title });
      saveProject(project);
      // IndexedDB write is async fire-and-forget — give it a beat before nav.
      await new Promise((r) => setTimeout(r, 250));
      toast.success(`Imported ${project.name} — opening editor`);
      onOpenProject(project.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Import failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="import-code-panel">
      {/* Language selector — active now + coming-soon (disabled) */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {LANGUAGES.map((l) => (
          <button
            key={l.id}
            type="button"
            disabled={!l.available}
            onClick={() => l.available && (setLang(l.id), setError(null))}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              lang === l.id
                ? "bg-brand text-white"
                : l.available
                  ? "bg-surface/80 text-muted-foreground hover:text-foreground"
                  : "cursor-not-allowed bg-surface/40 text-muted-foreground/40"
            }`}
            title={l.available ? l.label : `${l.label} — coming soon`}
            data-testid={`import-lang-${l.id}`}
          >
            {l.label}
            {!l.available && <span className="ml-1 opacity-70">soon</span>}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-surface/60 p-2">
        <textarea
          value={code}
          onChange={(e) => onPaste(e.target.value)}
          placeholder={
            lang === "react"
              ? "Paste a self-contained React component (JSX/TSX)…\n\nexport default function App() {\n  return <div style={{ padding: 24 }}>Hello</div>;\n}"
              : "Paste HTML/CSS…\n\n<style> .card { padding: 24px } </style>\n<div class=\"card\">Hello</div>"
          }
          spellCheck={false}
          className="h-52 w-full resize-none bg-transparent px-2 py-1.5 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          data-testid="import-code-input"
        />
        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-1 pt-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface/80 px-3 py-2 text-xs font-medium text-foreground/90 transition-colors hover:text-foreground"
              data-testid="import-upload-button"
            >
              <FileUp className="h-3.5 w-3.5" />
              Upload file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
              data-testid="import-file-input"
            />
            {uploadName && (
              <span className="max-w-[160px] truncate font-mono text-[11px] text-muted-foreground">{uploadName}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={!code.trim() || busy}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-8px_rgba(255,120,40,0.8)] transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
            data-testid="import-run-button"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Code2 className="h-4 w-4" />}
            Import to canvas
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300"
          data-testid="import-error"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {warnings.length > 0 && (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"
          data-testid="import-warning"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{warnings.join(" ")}</span>
        </div>
      )}
    </div>
  );
}
