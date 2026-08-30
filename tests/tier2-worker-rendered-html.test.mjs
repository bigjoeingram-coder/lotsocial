import assert from "node:assert/strict";
import test from "node:test";
import { startTier2Worker } from "./harness.mjs";

test("Tier 2 boots the built Worker and serves a real API response", async () => {
  const worker = await startTier2Worker();
  try {
    const response = await worker.fetch("http://localhost/api/vdp-imports");
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), { error: "Associate sign-in is required." });
  } finally {
    await worker.dispose();
  }
});

test("Tier 2 serves rendered LotSocial HTML for a signed-in associate", async () => {
  const worker = await startTier2Worker();
  try {
    const response = await worker.fetch("http://localhost/", {
      headers: {
        "oai-authenticated-user-email": "joe@example.com",
        "oai-authenticated-user-full-name": "Joe%20Associate",
        "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /LotSocial/);
    assert.match(html, /LotSocial Inventory Authorization/);
    assert.match(html, /Authorization workspace/);
    assert.match(html, /Privacy Policy/);
    assert.match(html, /Terms of Service/);
    assert.doesNotMatch(html, /SkeletonPreview|codex-preview/);
  } finally {
    await worker.dispose();
  }
});
