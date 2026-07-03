import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useStartClone, useGetCloneStatus, getGetCloneStatusQueryKey } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Terminal, 
  Download, 
  Globe, 
  FileArchive, 
  Zap, 
  AlertCircle, 
  Loader2, 
  CheckCircle2, 
  ChevronRight 
} from "lucide-react";

const formSchema = z.object({
  url: z.string().url({ message: "Please enter a valid URL (e.g., https://stripe.com)" }),
});

export default function Home() {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const startClone = useStartClone();
  const { data: jobStatus } = useGetCloneStatus(activeJobId ?? "", {
    query: {
      enabled: !!activeJobId && polling,
      refetchInterval: polling ? 1500 : false,
      queryKey: activeJobId ? getGetCloneStatusQueryKey(activeJobId) : ["status", "none"],
    },
  });

  // Stop polling once the job reaches a terminal state
  useEffect(() => {
    if (jobStatus?.status === 'done' || jobStatus?.status === 'error') {
      setPolling(false);
    }
  }, [jobStatus?.status]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: "",
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    setActiveJobId(null);
    setPolling(false);
    startClone.mutate(
      { data: { url: values.url } },
      {
        onSuccess: (data) => {
          setActiveJobId(data.jobId);
          setPolling(true);
        },
      }
    );
  };

  const getStatusBadge = (status: string | undefined) => {
    switch (status) {
      case 'pending':
        return (
          <span className="flex items-center gap-2 px-2.5 py-1 text-xs font-mono font-medium rounded border border-muted bg-muted text-muted-foreground shadow-sm">
            <Loader2 className="w-3 h-3 animate-spin" /> PENDING
          </span>
        );
      case 'running':
        return (
          <span className="flex items-center gap-2 px-2.5 py-1 text-xs font-mono font-medium rounded border border-primary/30 bg-primary/10 text-primary shadow-[0_0_10px_rgba(0,255,200,0.1)]">
            <Loader2 className="w-3 h-3 animate-spin" /> RUNNING
          </span>
        );
      case 'done':
        return (
          <span className="flex items-center gap-2 px-2.5 py-1 text-xs font-mono font-medium rounded border border-green-500/30 bg-green-500/10 text-green-500 shadow-[0_0_10px_rgba(34,197,94,0.1)]">
            <CheckCircle2 className="w-3 h-3" /> DONE
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-2 px-2.5 py-1 text-xs font-mono font-medium rounded border border-destructive/30 bg-destructive/10 text-destructive shadow-[0_0_10px_rgba(255,0,0,0.1)]">
            <AlertCircle className="w-3 h-3" /> ERROR
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 flex flex-col relative overflow-hidden">
      {/* Abstract terminal grid background */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]" 
        style={{ 
          backgroundImage: 'linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)', 
          backgroundSize: '40px 40px' 
        }}
      />
      <div className="absolute inset-0 z-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,rgba(0,255,200,0.03)_0%,transparent_70%)]" />

      <header className="relative z-10 w-full p-8 md:p-12 flex flex-col items-center">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-12 h-12 rounded-lg border-2 border-primary/40 bg-primary/10 flex items-center justify-center shadow-[0_0_20px_rgba(0,255,200,0.15)]">
            <Terminal className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-3xl font-mono font-bold tracking-tight text-white drop-shadow-sm">SiteClone</h1>
        </div>
        <p className="text-muted-foreground font-mono text-sm tracking-[0.2em] text-center">PRECISION WEBSITE EXTRACTION</p>
      </header>

      <main className="relative z-10 flex-1 w-full max-w-2xl mx-auto px-6 pb-24 pt-4 flex flex-col gap-10 items-center">
        
        <div className="w-full">
          <form onSubmit={handleSubmit(onSubmit)} className="w-full flex flex-col gap-3 group">
            <div className="relative flex items-center w-full shadow-lg">
              <div className="absolute left-5 text-muted-foreground group-focus-within:text-primary transition-colors">
                <ChevronRight className="w-5 h-5" />
              </div>
              <input
                {...register("url")}
                disabled={startClone.isPending}
                placeholder="https://stripe.com"
                className="w-full h-16 pl-12 pr-40 bg-card border-2 border-card-border rounded-lg outline-none font-mono text-lg transition-all focus:border-primary focus:shadow-[0_0_25px_rgba(0,255,200,0.15)] disabled:opacity-50 text-foreground placeholder:text-muted-foreground/60"
                autoComplete="off"
                spellCheck="false"
              />
              <button
                type="submit"
                disabled={startClone.isPending}
                className="absolute right-2 top-2 bottom-2 px-6 bg-foreground text-background font-mono font-bold text-sm rounded hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {startClone.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Clone Website"}
              </button>
            </div>
            <AnimatePresence>
              {errors.url && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-destructive font-mono text-xs px-2 flex items-center gap-2 pt-1"
                >
                  <AlertCircle className="w-4 h-4" />
                  {errors.url.message}
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        </div>

        <AnimatePresence mode="wait">
          {!activeJobId ? (
            <motion.div
              key="instructions"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="w-full grid grid-cols-1 md:grid-cols-3 gap-4"
            >
              {[
                { icon: Globe, label: "Any website", desc: "Works on public URLs" },
                { icon: Zap, label: "Full page capture", desc: "Scrolls to trigger load" },
                { icon: FileArchive, label: "Asset bundling", desc: "Zips CSS, images & JS" }
              ].map((feature, idx) => (
                <div key={idx} className="flex flex-col items-center text-center gap-3 p-6 rounded-lg border border-border bg-card/40 backdrop-blur-md">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground shadow-inner">
                    <feature.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-mono font-semibold text-sm text-foreground/90">{feature.label}</h3>
                    <p className="font-mono text-xs text-muted-foreground mt-1.5 leading-relaxed">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="job-card"
              initial={{ opacity: 0, scale: 0.98, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="w-full p-6 md:p-8 rounded-xl border-2 border-border bg-card shadow-2xl flex flex-col gap-8 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-50" />
              
              <div className="flex justify-between items-start gap-4">
                <div className="flex flex-col gap-1.5 overflow-hidden flex-1">
                  <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                    <Terminal className="w-3 h-3" /> Target URL
                  </span>
                  <span className="font-mono text-sm md:text-base font-medium truncate text-foreground bg-muted/50 px-3 py-1.5 rounded border border-border/50">
                    {jobStatus?.url || startClone.variables?.data.url || "Initializing..."}
                  </span>
                </div>
                <div className="mt-1">{getStatusBadge(jobStatus?.status || (startClone.isPending ? 'pending' : undefined))}</div>
              </div>

              <div className="w-full flex flex-col gap-3">
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-muted-foreground tracking-wider">PROGRESS</span>
                  <span className="text-primary font-bold">{jobStatus?.progress || 0}%</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden relative shadow-inner">
                  <motion.div
                    className="absolute top-0 left-0 h-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${jobStatus?.progress || 0}%` }}
                    transition={{ ease: "easeInOut", duration: 0.5 }}
                  />
                </div>
                <p className="font-mono text-xs text-muted-foreground mt-1 h-4 truncate">
                  {jobStatus?.message ? `> ${jobStatus.message}` : '> Awaiting dispatch...'}
                </p>
              </div>

              <AnimatePresence>
                {jobStatus?.status === 'done' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                    className="pt-6 border-t border-border flex justify-end"
                  >
                    <a
                      href={`/api/clone/${activeJobId}/download`}
                      download
                      className="inline-flex items-center justify-center gap-3 w-full md:w-auto px-8 py-3.5 bg-green-500 text-black font-mono font-bold text-sm rounded hover:bg-green-400 transition-all shadow-[0_0_20px_rgba(34,197,94,0.2)] hover:shadow-[0_0_30px_rgba(34,197,94,0.4)] active:scale-[0.98]"
                    >
                      <Download className="w-5 h-5" />
                      DOWNLOAD ZIP
                    </a>
                  </motion.div>
                )}
                {jobStatus?.status === 'error' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                    className="pt-6 border-t border-border flex flex-col gap-3"
                  >
                    <span className="font-mono text-xs text-destructive uppercase tracking-widest flex items-center gap-2">
                      <AlertCircle className="w-3 h-3" /> Error Output
                    </span>
                    <div className="p-4 bg-destructive/5 border border-destructive/20 rounded font-mono text-sm text-destructive leading-relaxed">
                      {jobStatus.message || "An unknown error occurred during cloning."}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      
      <footer className="relative z-10 w-full p-6 text-center font-mono text-[10px] text-muted-foreground/60 tracking-widest uppercase">
        System Active // {new Date().getFullYear()} SiteClone
      </footer>
    </div>
  );
}
