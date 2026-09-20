import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { QwenAIProvider } from "./qwen.ts";

const IMAGE = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);

async function withFetch<T>(stub: (input: Request | URL | string, init?: RequestInit) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

Deno.test("sends the image and key to /chat/completions and parses the reply", async () => {
  let seenUrl = "";
  let seenAuth = "";
  let seenBody: Record<string, any> = {};
  const provider = new QwenAIProvider("https://example.test/v1/", "secret-key", "qwen-test");

  const result = await withFetch(
    (input, init) => {
      seenUrl = String(input);
      seenAuth = (init?.headers as Record<string, string>).Authorization;
      seenBody = JSON.parse(String(init?.body));
      return Promise.resolve(reply('{"damage_type":"POTHOLE","confidence":0.9,"detections":[{"box":[100,100,500,500]}]}'));
    },
    () => provider.analyze(IMAGE, "image/jpeg"),
  );

  assertEquals(seenUrl, "https://example.test/v1/chat/completions");
  assertEquals(seenAuth, "Bearer secret-key");
  assertEquals(seenBody.model, "qwen-test");
  assertStringIncludes(seenBody.messages[1].content[0].image_url.url, "data:image/jpeg;base64,");
  assertEquals(result.errorMessage, undefined);
  assertEquals(result.damageType, "POTHOLE");
  assertEquals(result.detections.length, 1);
  assertEquals(result.provider, "qwen");
  assertEquals(result.modelName, "qwen-test");
});

Deno.test("reply content given as typed parts is accepted", async () => {
  const provider = new QwenAIProvider("https://example.test/v1", "k", "m");
  const result = await withFetch(
    () => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: '{"damage_type":"FLOODING","confidence":0.8,"detections":[]}' }] } }] }))),
    () => provider.analyze(IMAGE, "image/png"),
  );
  assertEquals(result.damageType, "FLOODING");
});

Deno.test("failures degrade to an errorMessage result instead of throwing", async () => {
  const provider = new QwenAIProvider("https://example.test/v1", "k", "m");
  const cases: [() => Promise<Response>, string][] = [
    [() => Promise.resolve(new Response("{}", { status: 401 })), "credentials"],
    [() => Promise.resolve(new Response("{}", { status: 429 })), "busy"],
    [() => Promise.resolve(new Response("{}", { status: 500 })), "could not analyse"],
    [() => Promise.reject(new TypeError("network down")), "unreachable"],
    [() => Promise.resolve(reply("I cannot help with that.")), "unreadable"],
  ];
  for (const [stub, fragment] of cases) {
    const result = await withFetch(stub, () => provider.analyze(IMAGE, "image/jpeg"));
    assertEquals(result.damageType, "UNKNOWN");
    assertEquals(result.detections, []);
    assertStringIncludes(result.errorMessage ?? "", fragment);
  }
});

Deno.test("with no API key it never calls the network", async () => {
  const provider = new QwenAIProvider("https://example.test/v1", "", "m");
  let called = false;
  const result = await withFetch(
    () => { called = true; return Promise.resolve(reply("{}")); },
    () => provider.analyze(IMAGE, "image/jpeg"),
  );
  assertEquals(called, false);
  assertStringIncludes(result.errorMessage ?? "", "not configured");
  assertEquals(await provider.health(), false);
});

Deno.test("the API key never appears in an error message", async () => {
  const provider = new QwenAIProvider("https://example.test/v1", "super-secret-123", "m");
  const result = await withFetch(() => Promise.resolve(new Response("bad key super-secret-123", { status: 401 })), () => provider.analyze(IMAGE, "image/jpeg"));
  assertEquals((result.errorMessage ?? "").includes("super-secret-123"), false);
});
