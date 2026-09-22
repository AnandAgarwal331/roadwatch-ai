import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { OpenMeteoWeatherProvider } from "./open-meteo.ts";

async function withFetch<T>(
  stub: (input: Request | URL | string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const AT = new Date("2026-09-22T14:30:00Z"); // cutoff hour: 14:00 UTC

/** 25 hourly slots from 2026-09-21T14:00 through 2026-09-22T14:00 (inclusive), so the "last 24 hours ending at 14:00" window is fully covered. */
function hourlyFixture(precipitation: number[]): { time: string[]; precipitation: number[] } {
  const start = new Date("2026-09-21T14:00:00Z").getTime();
  const time = precipitation.map((_, i) => new Date(start + i * 3_600_000).toISOString().slice(0, 16));
  return { time, precipitation };
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

Deno.test("reads temperature and sums the last 24 hours of rainfall", async () => {
  let seenUrl = "";
  const hourly = hourlyFixture(new Array(25).fill(1)); // 25 hours of 1mm each
  const provider = new OpenMeteoWeatherProvider();

  const result = await withFetch(
    (input) => {
      seenUrl = String(input);
      return Promise.resolve(reply({ current: { temperature_2m: 27.4 }, hourly }));
    },
    () => provider.getWeather(12.9, 77.6, AT),
  );

  assertStringIncludes(seenUrl, "api.open-meteo.com/v1/forecast");
  assertStringIncludes(seenUrl, "latitude=12.9000");
  assertStringIncludes(seenUrl, "past_hours=24");
  assertEquals(result.temperatureC, 27.4);
  assertEquals(result.provider, "open-meteo");
  // 24 of the 25 fixture hours fall in the [windowStart, cutoff] window.
  assertEquals(result.rainfallMm24h, 24);
});

Deno.test("condition follows the same thresholds the mock provider uses", async () => {
  const provider = new OpenMeteoWeatherProvider();
  const casesMmToCondition: [number, string][] = [
    [0, "clear"],
    [0.5, "clear"],
    [2, "light_rain"],
    [15, "rain"],
    [50, "heavy_rain"],
  ];

  for (const [totalMm, expected] of casesMmToCondition) {
    // Index 0 (2026-09-21T14:00) falls one hour before the 24h window this
    // fixture's AT cuts off at - see the "sums the last 24 hours" test - so
    // the value under test goes at the last index, which is always in range.
    const hourly = hourlyFixture([...new Array(24).fill(0), totalMm]);
    const result = await withFetch(
      () => Promise.resolve(reply({ current: { temperature_2m: 20 }, hourly })),
      () => provider.getWeather(0, 0, AT),
    );
    assertEquals(result.condition, expected, `${totalMm}mm should read as ${expected}`);
  }
});

Deno.test("falls back to the mock on a non-2xx response", async () => {
  const provider = new OpenMeteoWeatherProvider();
  const result = await withFetch(
    () => Promise.resolve(reply({}, 503)),
    () => provider.getWeather(12.9, 77.6, AT),
  );
  assertEquals(result.provider, "mock");
});

Deno.test("falls back to the mock when the network request itself fails", async () => {
  const provider = new OpenMeteoWeatherProvider();
  const result = await withFetch(
    () => Promise.reject(new Error("network down")),
    () => provider.getWeather(12.9, 77.6, AT),
  );
  assertEquals(result.provider, "mock");
});

Deno.test("falls back to the mock when the response is missing the fields this provider needs", async () => {
  const provider = new OpenMeteoWeatherProvider();

  const noTemperature = await withFetch(
    () => Promise.resolve(reply({ hourly: hourlyFixture(new Array(25).fill(0)) })),
    () => provider.getWeather(12.9, 77.6, AT),
  );
  assertEquals(noTemperature.provider, "mock");

  const noHourly = await withFetch(
    () => Promise.resolve(reply({ current: { temperature_2m: 20 } })),
    () => provider.getWeather(12.9, 77.6, AT),
  );
  assertEquals(noHourly.provider, "mock");
});

Deno.test("the returned reading always carries the caller's own observedAt, not the API's clock", async () => {
  const provider = new OpenMeteoWeatherProvider();
  const hourly = hourlyFixture(new Array(25).fill(0));
  const result = await withFetch(
    () => Promise.resolve(reply({ current: { temperature_2m: 20 }, hourly })),
    () => provider.getWeather(12.9, 77.6, AT),
  );
  assertEquals(result.observedAt, AT);
});
