import { z } from "zod";

/**
 * HTML is now the single source of truth for every screen. The AI generates
 * a shared design system (CSS variables + shared chrome CSS) once, then a
 * self-contained HTML fragment for each screen constrained by that system.
 * Both Lite (chat) and Pro (canvas) modes edit the same HTML document.
 *
 * Legacy `blocks` field is kept purely for one-time migration of pre-HTML
 * projects loaded from localStorage; new generations do not populate it.
 */

// Legacy block schema (unused by the live pipeline; retained for migration).
const LegacyBlockSchema = z.object({ type: z.string() }).passthrough();
export type Block = z.infer<typeof LegacyBlockSchema>;

export const ScreenSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  html: z.string(),
  // legacy — always empty for freshly generated projects
  blocks: z.array(LegacyBlockSchema).optional(),
});
export type Screen = z.infer<typeof ScreenSchema>;

export const DesignSystemSchema = z.object({
  palette: z.object({
    background: z.string(),
    surface: z.string(),
    text: z.string(),
    muted: z.string(),
    accent: z.string(),
    accentText: z.string(),
  }),
  radius: z.enum(["sm", "md", "lg", "xl"]).default("lg"),
  font: z.string().default("Inter"),
});
export type DesignSystem = z.infer<typeof DesignSystemSchema>;


// How a project renders on the canvas. Absent (all pre-existing projects) it
// defaults to a 375x812 phone app. Website imports set artifactType "website"
// with the captured viewport width; the renderer then drops the phone chrome
// and sizes the frame to match (PhoneScreenRenderer isWebsite/frameWidth).
// `pages` is the v2 multi-page hook: each cloned page maps to one screen.
export const FormatConfigSchema = z.object({
  // "figma" = a design imported from Figma (any dimensions). Renders on a
  // plain canvas — no phone chrome — at the Figma frame's real size. Distinct
  // from "website" (url-to-code: scrolling content, source URL) so Figma
  // projects don't inherit website-specific UI.
  artifactType: z.enum(["app", "website", "figma"]).default("app"),
  frame: z
    .object({
      width: z.number(),
      height: z.number().optional(),
    })
    .optional(),
  source: z
    .object({
      url: z.string(),
      capturedAt: z.number().optional(),
    })
    .optional(),
  pages: z
    .array(z.object({ screenId: z.string(), url: z.string() }))
    .optional(),
});
export type FormatConfig = z.infer<typeof FormatConfigSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  idea: z.string(),
  platform: z.enum(["ios", "android"]).default("ios"),
  designSystem: DesignSystemSchema,
  // Shared CSS injected into every screen: CSS variables, resets, shared
  // typography and any shared component classes (nav/tab bars).
  designSystemCss: z.string(),
  screens: z.array(ScreenSchema).min(1).max(24),
  format_config: FormatConfigSchema.optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

// Kept for reference; not used by the runtime.
export const BlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status_bar"),
    time: z.string().default("9:41"),
  }),
  z.object({
    type: z.literal("nav_bar"),
    title: z.string(),
    leading: z.string().nullable().optional(),
    trailing: z.string().nullable().optional(),
    large: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("hero"),
    eyebrow: z.string().nullable().optional(),
    title: z.string(),
    subtitle: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("hero_image"),
    title: z.string(),
    subtitle: z.string().nullable().optional(),
    accent: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("stat_grid"),
    stats: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        unit: z.string().nullable().optional(),
        tone: z.enum(["default", "brand", "positive", "warning"]).default("default"),
      }),
    ).min(2).max(4),
  }),
  z.object({
    type: z.literal("feature_card"),
    eyebrow: z.string().nullable().optional(),
    title: z.string(),
    subtitle: z.string().nullable().optional(),
    ctaLabel: z.string().nullable().optional(),
    filled: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("list"),
    heading: z.string().nullable().optional(),
    items: z.array(
      z.object({
        title: z.string(),
        subtitle: z.string().nullable().optional(),
        trailing: z.string().nullable().optional(),
      }),
    ).min(1).max(6),
  }),
  z.object({
    type: z.literal("card_grid"),
    heading: z.string().nullable().optional(),
    columns: z.union([z.literal(2), z.literal(3)]).default(2),
    items: z.array(
      z.object({
        title: z.string(),
        subtitle: z.string().nullable().optional(),
      }),
    ).min(2).max(6),
  }),
  z.object({
    type: z.literal("chips"),
    items: z.array(z.string()).min(2).max(6),
  }),
  z.object({
    type: z.literal("primary_button"),
    label: z.string(),
  }),
  z.object({
    type: z.literal("secondary_button"),
    label: z.string(),
  }),
  z.object({
    type: z.literal("form_field"),
    label: z.string(),
    placeholder: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("profile_header"),
    name: z.string(),
    subtitle: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("tab_bar"),
    items: z.array(z.string()).min(3).max(5),
    activeIndex: z.number().default(0),
  }),
  z.object({
    type: z.literal("spacer"),
    size: z.enum(["sm", "md", "lg"]).default("md"),
  }),
]);