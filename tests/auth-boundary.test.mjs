import assert from "node:assert/strict";
import test from "node:test";
import { startTier2Worker } from "./harness.mjs";

const associateHeaders = {
  "oai-authenticated-user-email": "joe@example.com",
  "oai-authenticated-user-full-name": "Joe%20Associate",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

test("allowlisted forged identity at a non-Sites host is rejected by the real worker", async () => {
  const worker = await startTier2Worker();
  try {
    const response = await worker.fetch("https://direct-worker.test/api/vdp-imports", {
      headers: associateHeaders,
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "This request must come through the LotSocial Sites address.",
    });
  } finally {
    await worker.dispose();
  }
});

test("allowlisted identity at the expected Sites host is accepted by the real worker", async () => {
  const worker = await startTier2Worker();
  try {
    const response = await worker.fetch("https://lotsocial.test/api/vdp-imports", {
      headers: associateHeaders,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { vehicles: [] });
  } finally {
    await worker.dispose();
  }
});

test("unknown associate at the expected Sites host is rejected by the real worker", async () => {
  const worker = await startTier2Worker();
  try {
    const response = await worker.fetch("https://lotsocial.test/api/vdp-imports", {
      headers: {
        ...associateHeaders,
        "oai-authenticated-user-email": "unknown@example.com",
      },
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "This associate is not approved for LotSocial access.",
    });
  } finally {
    await worker.dispose();
  }
});
