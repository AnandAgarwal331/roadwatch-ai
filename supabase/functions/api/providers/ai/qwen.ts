// Road-damage analysis with a Qwen vision-language model (Qwen-VL), through
// any OpenAI-compatible chat-completions endpoint: Alibaba Cloud Model Studio
// (DashScope), OpenRouter, or a self-hosted server such as vLLM. Which one is
// just AI_BASE_URL / AI_API_KEY / AI_MODEL - no code change.
//
// Like every provider, every failure degrades to an AnalysisResult with
// errorMessage set, which routes the report to manual review. A model outage
// or a bad key must never cost a citizen their report.
//
// Unlike the trained-YOLO route this is a general model being *asked* about
// road damage: its confidence is self-reported, not calibrated, and its boxes
// are approximate. Measure it on real photos before trusting it.

import type { AIAnalysisProvider, AnalysisResult } from "./base.ts";
import { parseQwenReply } from "./qwen_parse.ts";

const PROMPT = `You are a road-infrastructure inspector. Look at the photo and report visible road damage.

Damage types (use exactly these words):
- POTHOLE: a bowl-shaped hole in the road surface
- CRACKED_ROAD: cracks, alligator cracking, broken or crumbling asphalt
- FLOODING: standing water covering part of the road
- DAMAGED_SIDEWALK: broken or missing pavement/kerb for pedestrians
- BROKEN_STREETLIGHT: a fallen, bent or visibly broken street light

Rules:
- Only report damage you can actually see. If the photo is not of a road or you are unsure, answer NONE.
- "damage_type" is the single most serious damage in the photo, or NONE.
- "confidence" is 0 to 1: how sure you are of that damage_type.
- Give one entry in "detections" per separate damaged area, with a tight box.
- Boxes are [x1, y1, x2, y2] on a 0-1000 grid: origin at the top-left corner of the image, x to the right, y downward, (1000, 1000) is the bottom-right corner.

Reply with ONLY this JSON, no other text:
{"damage_type": "POTHOLE", "confidence": 0.9, "detections": [{"damage_type": "POTHOLE", "confidence": 0.9, "box": [120, 400, 560, 780]}]}
For no damage: {"damage_type": "NONE", "confidence": 0, "detections": []}`;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class QwenAIProvider implements AIAnalysisProvider {
  name = "qwen";

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    private timeoutMs = 45_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async analyze(imageBytes: Uint8Array, contentType: string): Promise<AnalysisResult> {
    if (!this.apiKey) return this.failure("The AI service is not configured.");

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 900,
          messages: [
            { role: "system", content: PROMPT },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:${contentType || "image/jpeg"};base64,${toBase64(imageBytes)}` } },
                { type: "text", text: "Inspect this photo." },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        return this.failure("The AI service took too long to respond.");
      }
      return this.failure("The AI service is unreachable.");
    }

    if (response.status === 401 || response.status === 403) return this.failure("The AI service rejected its credentials.");
    if (response.status === 429) return this.failure("The AI service is busy right now.");
    if (!response.ok) return this.failure("The AI service could not analyse the image.");

    let text: string;
    try {
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      // Some gateways return content as an array of typed parts.
      text = Array.isArray(content) ? content.map((p: { text?: string }) => p?.text ?? "").join("") : String(content ?? "");
    } catch {
      return this.failure("The AI service returned an unreadable response.");
    }

    const parsed = parseQwenReply(text);
    if (!parsed) return this.failure("The AI service returned an unreadable response.");

    return {
      damageType: parsed.damageType,
      confidence: parsed.confidence,
      detections: parsed.detections,
      damagedAreaRatio: parsed.damagedAreaRatio,
      modelName: this.model,
      modelVersion: "api",
      provider: this.name,
      processingMs: Date.now() - started,
    };
  }

  // A real call would cost money and quota on every poll, so health only
  // reports whether the provider is configured.
  health(): Promise<boolean> {
    return Promise.resolve(Boolean(this.apiKey));
  }

  private failure(message: string): AnalysisResult {
    return {
      damageType: "UNKNOWN",
      confidence: 0.0,
      detections: [],
      damagedAreaRatio: 0.0,
      modelName: this.model,
      modelVersion: "api",
      provider: this.name,
      processingMs: 0,
      errorMessage: message,
    };
  }
}
