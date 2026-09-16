import assert from "node:assert/strict";
import test from "node:test";
import worker from "../workers/render-source/worker.mjs";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function signature(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))).toString("base64url");
}

test("render source worker answers Shotstack HEAD checks with downloadable image headers", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const secret = "test-secret";
  const source = "https://dealer.example/photo.jpg";
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  const encoded = base64Url(source);
  const signed = await signature(secret, `${expires}.${encoded}`);
  let upstreamMethod = "";
  globalThis.caches = { default: { match: async () => undefined, put: async () => undefined } };
  globalThis.fetch = async (_url, options) => {
    upstreamMethod = options?.method || "GET";
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg", "Content-Length": "3" } });
  };
  try {
    const response = await worker.fetch(new Request(`https://proxy.example/image?e=${expires}&u=${encoded}&s=${signed}`, { method: "HEAD" }), { PROXY_SECRET: secret });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(response.headers.get("content-length"), "3");
    assert.equal(await response.text(), "");
    assert.equal(upstreamMethod, "GET");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});
