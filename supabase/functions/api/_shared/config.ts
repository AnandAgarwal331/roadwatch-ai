// Ported from backend/app/core/config.py's Settings. Edge Functions read
// config from environment variables set via `supabase secrets set` (there is
// no .env file at runtime), with the same defaults the Python app used.

function envFloat(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  return raw ? Number.parseFloat(raw) : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  return raw ? Number.parseInt(raw, 10) : fallback;
}

/** A JSON object from an env var; anything malformed or non-object becomes {}. */
function envJsonObject(name: string): Record<string, unknown> {
  const raw = Deno.env.get(name);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === "true" || raw === "1";
}

export const settings = {
  // -- Domain tuning (backend/app/core/config.py) --
  NEARBY_RADIUS_METERS: envInt("NEARBY_RADIUS_METERS", 500),
  DUPLICATE_RADIUS_METERS: envInt("DUPLICATE_RADIUS_METERS", 40),
  DUPLICATE_WINDOW_DAYS: envInt("DUPLICATE_WINDOW_DAYS", 30),
  HISTORY_RADIUS_METERS: envInt("HISTORY_RADIUS_METERS", 50),

  PRIORITY_WEIGHT_SEVERITY: envFloat("PRIORITY_WEIGHT_SEVERITY", 4.0),
  PRIORITY_WEIGHT_TRAFFIC: envFloat("PRIORITY_WEIGHT_TRAFFIC", 2.5),
  PRIORITY_WEIGHT_LOCATION: envFloat("PRIORITY_WEIGHT_LOCATION", 2.0),
  PRIORITY_WEIGHT_HISTORY: envFloat("PRIORITY_WEIGHT_HISTORY", 1.5),

  PRIORITY_THRESHOLD_MEDIUM: envFloat("PRIORITY_THRESHOLD_MEDIUM", 40.0),
  PRIORITY_THRESHOLD_HIGH: envFloat("PRIORITY_THRESHOLD_HIGH", 70.0),
  PRIORITY_THRESHOLD_CRITICAL: envFloat("PRIORITY_THRESHOLD_CRITICAL", 85.0),

  // -- Storage / uploads --
  MAX_UPLOAD_BYTES: envInt("MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
  ALLOWED_IMAGE_TYPES: (Deno.env.get("ALLOWED_IMAGE_TYPES") ?? "image/jpeg,image/png,image/webp")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  IMAGE_MAX_DIMENSION: envInt("IMAGE_MAX_DIMENSION", 1600),

  // -- AI / traffic / places / weather providers --
  // "mock" (dev stub), "http" (the standalone inference service) or "qwen"
  // (a Qwen-VL model through any OpenAI-compatible API - see providers/ai/qwen.ts).
  AI_PROVIDER: Deno.env.get("AI_PROVIDER") ?? "mock",
  // Used by the qwen provider. Defaults are for Alibaba Cloud Model Studio
  // (international); for OpenRouter use https://openrouter.ai/api/v1 and a
  // model id such as qwen/qwen2.5-vl-72b-instruct.
  AI_API_KEY: Deno.env.get("AI_API_KEY") ?? "",
  AI_MODEL: Deno.env.get("AI_MODEL") ?? "qwen-vl-max",
  AI_BASE_URL: Deno.env.get("AI_BASE_URL") ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  // Extra request fields merged into every qwen-provider call, as a JSON
  // object - for options only some hosts understand, e.g. Groq:
  // {"reasoning_effort":"none","response_format":{"type":"json_object"}}
  AI_EXTRA_PARAMS: envJsonObject("AI_EXTRA_PARAMS"),
  AI_SERVICE_URL: Deno.env.get("AI_SERVICE_URL") ?? "http://localhost:8001",
  AI_MIN_CONFIDENCE: envFloat("AI_MIN_CONFIDENCE", 0.45),
  TRAFFIC_PROVIDER: Deno.env.get("TRAFFIC_PROVIDER") ?? "mock",
  TRAFFIC_API_KEY: Deno.env.get("TRAFFIC_API_KEY") ?? "",
  TRAFFIC_API_URL: Deno.env.get("TRAFFIC_API_URL") ?? "",
  // "seeded" (the local catalogue), "overpass" (public OSM - unreliable, see
  // providers/places/overpass.ts), or "geoapify" (paid API, free-tier key).
  PLACES_PROVIDER: Deno.env.get("PLACES_PROVIDER") ?? "seeded",
  PLACES_API_URL: Deno.env.get("PLACES_API_URL") ?? "https://overpass-api.de/api/interpreter",
  PLACES_API_KEY: Deno.env.get("PLACES_API_KEY") ?? "",
  WEATHER_ENABLED: envBool("WEATHER_ENABLED", false),
  WEATHER_PROVIDER: Deno.env.get("WEATHER_PROVIDER") ?? "mock",

  // -- Rate limiting --
  RATE_LIMIT_ENABLED: envBool("RATE_LIMIT_ENABLED", true),
  RATE_LIMIT_AUTH_PER_MINUTE: envInt("RATE_LIMIT_AUTH_PER_MINUTE", 10),
  RATE_LIMIT_WRITE_PER_MINUTE: envInt("RATE_LIMIT_WRITE_PER_MINUTE", 30),

  // -- CORS --
  CORS_ORIGINS: (Deno.env.get("CORS_ORIGINS") ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
