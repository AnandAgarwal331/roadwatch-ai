// Ported from backend/app/providers/ai/factory.py.

import { settings } from "../../_shared/config.ts";
import type { AIAnalysisProvider } from "./base.ts";
import { MockAIProvider } from "./mock.ts";
import { HttpAIProvider } from "./http.ts";
import { QwenAIProvider } from "./qwen.ts";

let cached: AIAnalysisProvider | null = null;

export function getAIProvider(): AIAnalysisProvider {
  if (cached) return cached;
  const provider = settings.AI_PROVIDER.trim().toLowerCase();
  if (provider === "http") {
    cached = new HttpAIProvider(settings.AI_SERVICE_URL, 20_000);
  } else if (provider === "qwen") {
    cached = new QwenAIProvider(settings.AI_BASE_URL, settings.AI_API_KEY, settings.AI_MODEL);
  } else {
    cached = new MockAIProvider();
  }
  return cached;
}
