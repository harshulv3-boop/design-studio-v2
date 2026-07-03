export type Template = {
  id: string;
  name: string;
  category: string;
  description: string;
  idea: string;
  style: string;
  accent: string;
};

export const TEMPLATES: Template[] = [
  {
    id: "fitness",
    name: "Health Tracker",
    category: "Health",
    description: "Personal health dashboard. Widgets for heart rate graph, sleep quality score with moon icon, activity rings.",
    idea: "A minimalist fitness tracking app with dark mode, activity rings, workout sessions, and personal records. Include onboarding, home dashboard, workout detail, and profile.",
    style: "NEO-BRUTALISM",
    accent: "#FF3B6B",
  },
  {
    id: "crypto",
    name: "Crypto Wallet",
    category: "Finance",
    description: "Cryptocurrency wallet dashboard. A holographic virtual credit card. Line graphs for portfolio movement.",
    idea: "A cryptocurrency wallet app with glassmorphism. Holographic virtual credit card, portfolio line graphs, token list, and send / receive flow.",
    style: "GLASSMORPHISM",
    accent: "#7C5CFF",
  },
  {
    id: "pet",
    name: "Pet Manager",
    category: "Lifestyle",
    description: "Pet management app. Pet avatars are cute, stylized drawings. Task checklist items have soft playful icons.",
    idea: "A playful pet care app with cute stylized pet avatars, feeding schedule, vet appointments, and a fun daily activity tracker.",
    style: "PLAYFUL WHIMSICAL",
    accent: "#FF8A3D",
  },
  {
    id: "subscriptions",
    name: "Subscription Tracker",
    category: "Finance",
    description: "Subscription tracker dashboard. Total monthly and yearly spending displayed prominently with soft claymorphic cards.",
    idea: "A subscription tracker app with soft claymorphic 3D cards. Monthly & yearly spending totals, upcoming renewals, and a list of active subscriptions with logos.",
    style: "SOFT CLAY 3D MINIMAL",
    accent: "#3DD68C",
  },
  {
    id: "food",
    name: "Warm Cookbook",
    category: "Lifestyle",
    description: "Recipe discovery app with warm editorial styling. Recipe of the day hero, cuisine categories, and saved collections.",
    idea: "A warm editorial recipe app: recipe of the day hero, cuisine categories, saved recipes, and full recipe detail with ingredients and steps.",
    style: "EDITORIAL WARM",
    accent: "#E8A15A",
  },
  {
    id: "travel",
    name: "Warm Storybook",
    category: "Travel",
    description: "Illustrated weather / travel companion with cheerful storybook illustrations, 7-day forecast, and city picker.",
    idea: "A cheerful illustrated weather & travel app with hand-drawn sun/cloud characters, 7-day forecast list, and city switcher.",
    style: "STORYBOOK ILLUSTRATED",
    accent: "#FFC24D",
  },
  {
    id: "productivity",
    name: "Teal Vitals",
    category: "Productivity",
    description: "Health dashboard with weekly calendar, calorie & macro rings, and workout log in a calm teal palette.",
    idea: "A calm teal health dashboard: weekly calendar strip, daily calories & macros with rings, workout log, and profile.",
    style: "CALM TEAL",
    accent: "#22C7A0",
  },
  {
    id: "meditation",
    name: "Neon Running",
    category: "Wellness",
    description: "Bold running tracker. High-contrast neon accents, oversized timers, pace and distance stats.",
    idea: "A bold running tracker with pitch-black backgrounds, neon lime accents, oversized duration & distance, splits, and route summary.",
    style: "NEON DARK",
    accent: "#CFFF3D",
  },
];