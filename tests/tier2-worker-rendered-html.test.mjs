import assert from "node:assert/strict";
import test from "node:test";
import { startTier2Worker } from "./harness.mjs";

const associateHeaders = {
  "oai-authenticated-user-email": "joe@example.com",
  "oai-authenticated-user-full-name": "Joe%20Associate",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

test("Tier 2 boots the built Worker and serves a real API response", async () => {
  const worker = await startTier2Worker();
  try {
    const response = await worker.fetch("https://lotsocial.test/api/vdp-imports");
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), { error: "Associate sign-in is required." });
  } finally {
    await worker.dispose();
  }
});

test("Tier 2 serves rendered LotSocial HTML", async () => {
  const worker = await startTier2Worker();
  try {
    const response = await worker.fetch("https://lotsocial.test/privacy");
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /LotSocial/);
    assert.match(html, /Privacy Policy/);
    assert.match(html, /Terms of Service/);
    assert.doesNotMatch(html, /SkeletonPreview|codex-preview/);
  } finally {
    await worker.dispose();
  }
});

test("Tier 2 serves the workspace UI for a signed-in allowlisted associate at the expected Sites host", async () => {
  const worker = await startTier2Worker();
  try {
    const response = await worker.fetch("https://lotsocial.test/", {
      headers: associateHeaders,
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /LotSocial Inventory Authorization/);
    assert.match(html, /Authorization workspace/);
    assert.doesNotMatch(html, /signin-with-chatgpt/);
  } finally {
    await worker.dispose();
  }
});

test("Tier 2 does not render the workspace UI for the same signed-in request at a non-Sites host", async () => {
  const worker = await startTier2Worker();
  try {
    const response = await worker.fetch("https://direct-worker.test/", {
      headers: associateHeaders,
      redirect: "manual",
    });
    const body = await response.text();

    assert.notEqual(response.status, 200);
    assert.doesNotMatch(body, /Authorization workspace/);
  } finally {
    await worker.dispose();
  }
});
