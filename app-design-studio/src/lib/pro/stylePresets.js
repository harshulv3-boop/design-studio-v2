// Built-in library presets. These are never stored in the project —
// they are always available globally and are read-only.
// Future: team / marketplace libraries extend LIBRARY_PRESETS at runtime.

export const LIBRARY_PRESETS = [
  // ── Buttons ───────────────────────────────────────────────────────────
  {
    id: "lib-btn-primary",
    name: "Button Primary",
    category: "Buttons",
    preview: "#6366f1",
    properties: {
      backgroundColor: "#6366f1",
      color: "#ffffff",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "600",
      padding: "10px 20px",
      border: "none",
      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
      opacity: "1",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
    },
  },
  {
    id: "lib-btn-secondary",
    name: "Button Secondary",
    category: "Buttons",
    preview: "#27272a",
    properties: {
      backgroundColor: "transparent",
      color: "#a1a1aa",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "500",
      padding: "10px 20px",
      border: "1px solid #3f3f46",
      boxShadow: "none",
      opacity: "1",
    },
  },
  {
    id: "lib-btn-ghost",
    name: "Button Ghost",
    category: "Buttons",
    preview: "#ffffff10",
    properties: {
      backgroundColor: "rgba(255,255,255,0.06)",
      color: "#e4e4e7",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "500",
      padding: "10px 20px",
      border: "1px solid rgba(255,255,255,0.1)",
    },
  },
  {
    id: "lib-btn-destructive",
    name: "Button Destructive",
    category: "Buttons",
    preview: "#ef4444",
    properties: {
      backgroundColor: "#ef4444",
      color: "#ffffff",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "600",
      padding: "10px 20px",
      border: "none",
      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
    },
  },

  // ── Containers ────────────────────────────────────────────────────────
  {
    id: "lib-card",
    name: "Card",
    category: "Containers",
    preview: "#1c1c1e",
    properties: {
      backgroundColor: "#1c1c1e",
      borderRadius: "12px",
      padding: "24px",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      border: "1px solid rgba(255,255,255,0.08)",
    },
  },
  {
    id: "lib-glass-card",
    name: "Glass Card",
    category: "Containers",
    preview: "#ffffff18",
    properties: {
      backgroundColor: "rgba(255,255,255,0.06)",
      borderRadius: "16px",
      padding: "24px",
      border: "1px solid rgba(255,255,255,0.12)",
      backdropFilter: "blur(16px)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
    },
  },
  {
    id: "lib-dark-panel",
    name: "Dark Panel",
    category: "Containers",
    preview: "#09090b",
    properties: {
      backgroundColor: "#09090b",
      borderRadius: "8px",
      padding: "16px",
      border: "1px solid #27272a",
    },
  },
  {
    id: "lib-frosted",
    name: "Frosted Panel",
    category: "Containers",
    preview: "#18181b",
    properties: {
      backgroundColor: "rgba(24,24,27,0.85)",
      borderRadius: "12px",
      padding: "20px",
      border: "1px solid rgba(255,255,255,0.07)",
      backdropFilter: "blur(20px)",
    },
  },

  // ── Sections ──────────────────────────────────────────────────────────
  {
    id: "lib-hero",
    name: "Hero",
    category: "Sections",
    preview: "#6366f1",
    properties: {
      backgroundColor: "#6366f1",
      borderRadius: "0px",
      padding: "80px 40px",
      color: "#ffffff",
    },
  },
  {
    id: "lib-hero-dark",
    name: "Hero Dark",
    category: "Sections",
    preview: "#09090b",
    properties: {
      backgroundColor: "#09090b",
      color: "#ffffff",
      padding: "80px 40px",
    },
  },

  // ── Typography ────────────────────────────────────────────────────────
  {
    id: "lib-heading-h1",
    name: "Heading H1",
    category: "Typography",
    preview: "#ffffff",
    properties: {
      fontSize: "48px",
      fontWeight: "700",
      color: "#ffffff",
      lineHeight: "56px",
      letterSpacing: "-0.02em",
    },
  },
  {
    id: "lib-heading-h2",
    name: "Heading H2",
    category: "Typography",
    preview: "#e4e4e7",
    properties: {
      fontSize: "32px",
      fontWeight: "600",
      color: "#e4e4e7",
      lineHeight: "40px",
      letterSpacing: "-0.01em",
    },
  },
  {
    id: "lib-body",
    name: "Body Text",
    category: "Typography",
    preview: "#a1a1aa",
    properties: {
      fontSize: "14px",
      fontWeight: "400",
      color: "#a1a1aa",
      lineHeight: "22px",
      letterSpacing: "0px",
    },
  },
  {
    id: "lib-caption",
    name: "Caption",
    category: "Typography",
    preview: "#71717a",
    properties: {
      fontSize: "12px",
      fontWeight: "400",
      color: "#71717a",
      lineHeight: "18px",
    },
  },

  // ── Labels ────────────────────────────────────────────────────────────
  {
    id: "lib-badge-neutral",
    name: "Badge Neutral",
    category: "Labels",
    preview: "#3f3f46",
    properties: {
      backgroundColor: "#3f3f46",
      color: "#a1a1aa",
      borderRadius: "999px",
      fontSize: "12px",
      fontWeight: "500",
      padding: "3px 10px",
    },
  },
  {
    id: "lib-badge-indigo",
    name: "Badge Indigo",
    category: "Labels",
    preview: "#4f46e5",
    properties: {
      backgroundColor: "rgba(99,102,241,0.15)",
      color: "#818cf8",
      borderRadius: "999px",
      fontSize: "12px",
      fontWeight: "500",
      padding: "3px 10px",
      border: "1px solid rgba(99,102,241,0.3)",
    },
  },
  {
    id: "lib-badge-green",
    name: "Badge Green",
    category: "Labels",
    preview: "#16a34a",
    properties: {
      backgroundColor: "rgba(22,163,74,0.15)",
      color: "#4ade80",
      borderRadius: "999px",
      fontSize: "12px",
      fontWeight: "500",
      padding: "3px 10px",
      border: "1px solid rgba(22,163,74,0.3)",
    },
  },
];

// Ordered category list for the Libraries tab grouping.
export const PRESET_CATEGORIES = ["Buttons", "Containers", "Sections", "Typography", "Labels"];
