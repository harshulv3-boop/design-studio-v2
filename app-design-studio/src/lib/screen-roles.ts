// Catalog of preset screen types for the pre-select-screens feature.
// Each entry maps a user-facing screen "type" to the { id, name, role }
// triple the generation pipeline already understands (see Phase1.screens in
// src/routes/api/generate.ts and ScreenSchema in src/lib/screen-schema.ts).
//
// `role` is a free-form string throughout the pipeline; introducing a typed
// catalog here gives the landing-page picker a stable set of options without
// breaking downstream consumers (everything still treats role as opaque).

export type ScreenTypePreset = {
  id: string;
  name: string;
  role: string;
  description: string;
};

// Sensible default selection (used when the user doesn't customize): a
// connected 5-screen flow covering the most common mobile-app surfaces.
export const DEFAULT_SELECTED_SCREEN_IDS = [
  "home",
  "dashboard",
  "profile",
  "settings",
  "notifications",
];

export const SCREEN_TYPE_CATALOG: ScreenTypePreset[] = [
  {
    id: "home",
    name: "Home",
    role: "home",
    description: "Primary landing surface with key entry points",
  },
  {
    id: "dashboard",
    name: "Dashboard",
    role: "dashboard",
    description: "Overview with stats, summaries, and activity",
  },
  {
    id: "profile",
    name: "Profile",
    role: "profile",
    description: "User account, avatar, and personal details",
  },
  {
    id: "settings",
    name: "Settings",
    role: "settings",
    description: "Preferences, toggles, and account configuration",
  },
  {
    id: "analytics",
    name: "Analytics",
    role: "analytics",
    description: "Charts, metrics, and trends",
  },
  {
    id: "notifications",
    name: "Notifications",
    role: "notifications",
    description: "Activity feed and alerts inbox",
  },
  {
    id: "search",
    name: "Search",
    role: "search",
    description: "Discovery / search results surface",
  },
  { id: "details", name: "Details", role: "details", description: "Item / content detail view" },
  { id: "inbox", name: "Inbox", role: "inbox", description: "Messages or conversations list" },
  {
    id: "onboarding",
    name: "Onboarding",
    role: "onboarding",
    description: "Welcome / getting-started flow",
  },
  { id: "auth", name: "Sign In", role: "auth", description: "Login / sign-up / authentication" },
  { id: "checkout", name: "Checkout", role: "checkout", description: "Purchase / payment flow" },
];

// Hard bounds - must stay inside ProjectSchema's screens array (min 1, max 24).
export const MIN_SCREEN_COUNT = 1;
export const MAX_SCREEN_COUNT = 12;

export type ScreenSelection = { id: string; name: string; role: string };

// Resolve a list of selected preset ids into the { id, name, role } manifest
// the server expects. Preserves catalog order; unknown ids are dropped.
export function resolveScreenSelection(selectedIds: string[]): ScreenSelection[] {
  const seen = new Set<string>();
  const out: ScreenSelection[] = [];
  for (const preset of SCREEN_TYPE_CATALOG) {
    if (selectedIds.includes(preset.id) && !seen.has(preset.id)) {
      seen.add(preset.id);
      out.push({ id: preset.id, name: preset.name, role: preset.role });
    }
  }
  return out;
}
