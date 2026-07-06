import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import fs from "node:fs";
import path from "node:path";

function loadLocalEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "app-design-studio", ".env"),
  ];

  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) process.env[key] = value;
  }
}

loadLocalEnv();

export function createLovableAiGatewayProvider(lovableApiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
}

export function createGeminiProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

export function createOpenAiProvider(apiKey: string, baseURL = "https://api.openai.com/v1") {
  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
}
