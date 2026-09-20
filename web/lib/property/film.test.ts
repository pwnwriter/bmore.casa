import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { rewriteTileset } from "./tiles";
import { tourPose, TOUR_SECONDS } from "./tour";
import { readVideoOperation, signVideoOperation } from "./video-token";
import { GET, POST } from "../../app/api/property/video/route";

test("nested tiles retain sessions but never provider credentials", () => {
  const root = new URL("https://tile.googleapis.com/v1/3dtiles/root.json?key=secret&session=abc");
  const result = rewriteTileset({ root: { children: [{ content: { uri: "tiles/one.glb?key=secret" } }, { content: { url: "https://tile.googleapis.com/v1/3dtiles/two.json?session=def&key=secret" } }] } }, root);
  assert.deepEqual(result, { root: { children: [{ content: { uri: "/api/tiles3d/tiles/one.glb?session=abc" } }, { content: { url: "/api/tiles3d/two.json?session=def" } }] } });
  assert.ok(!JSON.stringify(result).includes("secret"));
  for (const uri of ["https://evil.example/tile", "//evil.example/tile", "../../outside"]) assert.throws(() => rewriteTileset({ uri }, root));
});

test("camera stays continuous and above the target across all shots", () => {
  assert.deepEqual(tourPose(-1), tourPose(0));
  assert.deepEqual(tourPose(100), tourPose(TOUR_SECONDS));
  for (const boundary of [9, 27]) {
    const a = tourPose(boundary - 0.00001), b = tourPose(boundary);
    for (const key of ["heading", "radius", "height"] as const) assert.ok(Math.abs(a[key] - b[key]) < 0.001);
  }
  for (let t = 0; t <= TOUR_SECONDS; t += 0.1) assert.ok(tourPose(t).height >= 55 && tourPose(t).radius >= 90);
});

test("video tokens reject tampering, wrong keys, expiration and arbitrary operation paths", () => {
  const operation = "models/veo-3.1-fast-generate-preview/operations/test-123";
  const token = signVideoOperation(operation, "test-key");
  assert.equal(readVideoOperation(token, "test-key"), operation);
  for (const bad of [token + ".extra", "x".repeat(2001), token.slice(0, -8), "abc.def"]) assert.throws(() => readVideoOperation(bad, "test-key"));
  assert.throws(() => readVideoOperation(token, "other-key"));
  assert.throws(() => signVideoOperation("https://evil.example/operation", "test-key"));
  const expired = Buffer.from(JSON.stringify({ operation, expires: Date.now() - 1000 })).toString("base64url");
  assert.throws(() => readVideoOperation(`${expired}.${createHmac("sha256", "test-key").update(expired).digest("base64url")}`, "test-key"));
});

test("photo video API validates input, polls signed jobs and strips keys on media redirects", async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "local-test-key";
  const operation = "models/veo-3.1-fast-generate-preview/operations/test-123";
  let finished = false, externalMedia = false, calls = 0;
  globalThis.fetch = (async (input, init) => {
    calls++;
    const url = String(input);
    if (url.endsWith(":predictLongRunning")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.instances[0].image.inlineData.mimeType, "image/png");
      assert.equal(body.parameters.durationSeconds, 8);
      return Response.json({ name: operation });
    }
    if (url.endsWith(operation)) return Response.json(finished ? { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: externalMedia ? "https://evil.example/video" : "https://generativelanguage.googleapis.com/v1beta/files/123:download?alt=media" } }] } } } : { done: false });
    if (url.includes("/files/")) return new Response(null, { status: 302, headers: { location: "https://storage.googleapis.com/video-test/clip.mp4" } });
    assert.equal(url, "https://storage.googleapis.com/video-test/clip.mp4");
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), null);
    return new Response("test video", { headers: { "Content-Type": "video/mp4" } });
  }) as typeof fetch;
  try {
    const form = new FormData();
    form.set("property", JSON.stringify({ layer: "vacant", index: 0 }));
    form.set("brief", "Restore the exterior");
    form.set("photo", new File(["not an image"], "bad.png", { type: "image/png" }));
    assert.equal((await POST(new Request("http://localhost/api/property/video", { method: "POST", body: form }))).status, 400);
    assert.equal(calls, 0);
    form.set("photo", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "reference.png", { type: "image/png" }));
    const response = await POST(new Request("http://localhost/api/property/video", { method: "POST", body: form }));
    assert.equal(response.status, 202);
    const { token } = await response.json();
    const url = `http://localhost/api/property/video?token=${encodeURIComponent(token)}`;
    assert.deepEqual(await (await GET(new Request(url))).json(), { done: false });
    finished = true;
    assert.deepEqual(await (await GET(new Request(url))).json(), { done: true });
    const media = await GET(new Request(`${url}&media=1&download=1`));
    assert.equal(media.headers.get("content-type"), "video/mp4");
    assert.match(media.headers.get("content-disposition")!, /attachment/);
    assert.equal(await media.text(), "test video");
    externalMedia = true;
    assert.equal((await GET(new Request(`${url}&media=1`))).status, 502);
    assert.equal((await GET(new Request("http://localhost/api/property/video?token=forged"))).status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});
