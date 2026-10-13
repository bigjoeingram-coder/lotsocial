import assert from "node:assert/strict";
import test from "node:test";
import { LinkedInAdapter } from "../app/lib/posting/adapters/linkedin.ts";
import { PRODUCTION_ADAPTERS } from "../app/lib/posting-tick-handler.ts";

// Fixtures follow the sample requests and responses on the official LinkedIn Posts API and Videos API pages
// (read 2026-10-13). No test calls LinkedIn.
const POST_URN = "urn:li:share:6844785523593134080";
const VIDEO_URN = "urn:li:video:C5505AQH-oV1qvnFtKA";
const destination = { id: "dest-1", platform: "linkedin", platformRef: "urn:li:person:5abc_dEfgH", kind: "member", connectionId: "conn-1", credentialsRef: "LINKEDIN_TOKEN_JOE" };
const textVariant = { variantId: "v1", platform: "linkedin", caption: "Sample text Post", title: "", description: "", platformOptions: {}, mediaStorageKey: "", revisionHash: "hash-1" };
const videoVariant = { ...textVariant, caption: "Sample video Post", title: "title of the video", mediaStorageKey: "renders/proj-1.mp4" };

function json(status, body, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

// Routes each request to a scripted response and records what was sent.
function harness(routes, overrides = {}) {
  const calls = [];
  const adapter = new LinkedInAdapter({
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
      const route = routes.find((candidate) => candidate.match(url, init.method ?? "GET"));
      if (!route) throw new Error(`Unexpected request: ${init.method} ${url}`);
      return route.respond(calls.length);
    },
    getAccessToken: async (ref) => (ref === "LINKEDIN_TOKEN_JOE" ? "test-token" : null),
    readMedia: async () => new ArrayBuffer(200 * 1024),
    apiVersion: "202609",
    sleep: async () => {},
    ...overrides,
  });
  return { adapter, calls };
}

const createOk = { match: (url, method) => method === "POST" && url === "https://api.linkedin.com/rest/posts", respond: () => json(201, null, { "x-restli-id": POST_URN }) };
const videoRoutes = (status = "AVAILABLE") => [
  { match: (url) => url.endsWith("/videos?action=initializeUpload"), respond: () => json(200, { value: { uploadUrlsExpireAt: 1633234498985, video: VIDEO_URN, uploadToken: "", uploadInstructions: [
    { uploadUrl: "https://www.linkedin.com/dms-uploads/part-1", firstByte: 0, lastByte: 102399 },
    { uploadUrl: "https://www.linkedin.com/dms-uploads/part-2", firstByte: 102400, lastByte: 204799 },
  ] } }) },
  { match: (url, method) => method === "PUT", respond: (count) => new Response(null, { status: 200, headers: { etag: `/ambry-videoei/signedId/part-${count}` } }) },
  { match: (url) => url.endsWith("/videos?action=finalizeUpload"), respond: () => json(200, null) },
  { match: (url, method) => method === "GET" && url.includes("/rest/videos/"), respond: () => json(200, { id: VIDEO_URN, status }) },
];

test("the LinkedIn adapter is not registered for production", () => {
  assert.equal("linkedin" in PRODUCTION_ADAPTERS, false);
});

test("every LinkedIn capability is marked as not live tested, and client references are unsupported", () => {
  const { adapter } = harness([]);
  const manifest = adapter.getCapabilities();
  assert.ok(!Object.values(manifest.features).includes("VERIFIED_LIVE"));
  assert.equal(manifest.features.find_by_client_ref, "UNSUPPORTED");
  assert.deepEqual(adapter.requiredScopes("post:member"), ["w_member_social"]);
  assert.deepEqual(adapter.requiredScopes("post:organization"), ["w_organization_social"]);
  assert.deepEqual(adapter.requiredScopes("read:member"), ["r_member_social"]);
});

test("validation rejects empty text, over-long text and non-MP4 media before any request", () => {
  const { adapter, calls } = harness([]);
  assert.equal(adapter.validateContent({ ...textVariant, caption: " " }).ok, false);
  assert.equal(adapter.validateContent({ ...textVariant, caption: "x".repeat(3001) }).ok, false);
  assert.equal(adapter.validateContent({ ...videoVariant, mediaStorageKey: "renders/a.mov" }).ok, false);
  assert.equal(adapter.validateContent(textVariant).ok, true);
  assert.equal(calls.length, 0);
});

test("a text post sends the documented request and returns the post id from x-restli-id", async () => {
  const { adapter, calls } = harness([createOk]);
  const outcome = await adapter.createPost(destination, textVariant, "client-ref");
  assert.deepEqual(outcome, { kind: "published", platformPostId: POST_URN, platformUrl: `https://www.linkedin.com/feed/update/${POST_URN}/`, providerRequestId: undefined });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, "Bearer test-token");
  assert.equal(calls[0].headers["Linkedin-Version"], "202609");
  assert.equal(calls[0].headers["X-Restli-Protocol-Version"], "2.0.0");
  assert.deepEqual(JSON.parse(calls[0].body), {
    author: "urn:li:person:5abc_dEfgH", commentary: "Sample text Post", visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
  });
});

test("a video post uploads each part, finalizes with the ETags in order, then posts with the video URN", async () => {
  const { adapter, calls } = harness([...videoRoutes(), createOk]);
  const outcome = await adapter.createPost(destination, videoVariant, "client-ref");
  assert.equal(outcome.kind, "published");
  const init = JSON.parse(calls[0].body).initializeUploadRequest;
  assert.deepEqual(init, { owner: "urn:li:person:5abc_dEfgH", fileSizeBytes: 204800, uploadCaptions: false, uploadThumbnail: false });
  const parts = calls.filter((call) => call.method === "PUT");
  assert.deepEqual(parts.map((call) => call.body.byteLength), [102400, 102400]);
  assert.equal(parts[0].headers.Authorization, undefined, "the bearer token is not sent to the upload host");
  const finalize = JSON.parse(calls.find((call) => call.url.endsWith("finalizeUpload")).body).finalizeUploadRequest;
  assert.deepEqual(finalize, { video: VIDEO_URN, uploadToken: "", uploadedPartIds: ["/ambry-videoei/signedId/part-2", "/ambry-videoei/signedId/part-3"] });
  const post = JSON.parse(calls.at(-1).body);
  assert.deepEqual(post.content, { media: { title: "title of the video", id: VIDEO_URN } });
});

test("a video still processing returns a retryable result and creates no post", async () => {
  const { adapter, calls } = harness([...videoRoutes("PROCESSING"), createOk], { videoStatusPolls: 2 });
  const outcome = await adapter.createPost(destination, videoVariant, "client-ref");
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.code, "MEDIA_PROCESSING");
  assert.equal(outcome.retryable, true);
  assert.equal(calls.some((call) => call.url.endsWith("/rest/posts")), false);
});

test("a video LinkedIn cannot process fails without a post", async () => {
  const { adapter, calls } = harness([...videoRoutes("PROCESSING_FAILED"), createOk]);
  const outcome = await adapter.createPost(destination, videoVariant, "client-ref");
  assert.equal(outcome.code, "PLATFORM_REJECTED");
  assert.equal(calls.some((call) => call.url.endsWith("/rest/posts")), false);
});

test("a missing token is an auth failure with no request sent", async () => {
  const { adapter, calls } = harness([createOk]);
  const outcome = await adapter.createPost({ ...destination, credentialsRef: "UNKNOWN" }, textVariant, "client-ref");
  assert.equal(outcome.code, "AUTH_REQUIRED");
  assert.equal(calls.length, 0);
});

test("documented error codes map to the engine's error types", async () => {
  const cases = [[401, "AUTH_REQUIRED", false], [403, "PERMISSION_DENIED", false], [400, "VALIDATION", false], [422, "VALIDATION", false], [429, "RATE_LIMITED", true]]; // 409 on create is uncertain since the review (see below)
  for (const [status, code, retryable] of cases) {
    const { adapter } = harness([{ match: () => true, respond: () => json(status, { code: "X", message: "sample" }, status === 429 ? { "retry-after": "90" } : {}) }]);
    const outcome = await adapter.createPost(destination, textVariant, "client-ref");
    assert.equal(outcome.kind, "failed", String(status));
    assert.equal(outcome.code, code, String(status));
    assert.equal(outcome.retryable, retryable, String(status));
    if (status === 429) assert.equal(outcome.retryAfterSeconds, 90);
  }
});

test("a server error or a 201 without an id on create is uncertain, never a clean failure", async () => {
  const server = harness([{ match: () => true, respond: () => json(503, { message: "unavailable" }) }]);
  assert.equal((await server.adapter.createPost(destination, textVariant, "client-ref")).kind, "uncertain");
  const noId = harness([{ match: () => true, respond: () => json(201, null) }]);
  assert.equal((await noId.adapter.createPost(destination, textVariant, "client-ref")).kind, "uncertain");
});

test("a network error on create is thrown, so the engine records an uncertain write", async () => {
  const { adapter } = harness([], { fetch: async () => { throw new Error("socket hang up"); } });
  await assert.rejects(() => adapter.createPost(destination, textVariant, "client-ref"), /socket hang up/);
});

test("readback maps lifecycle states and treats only 404 as a definitive miss", async () => {
  const state = (lifecycleState) => harness([{ match: (url) => url.includes(encodeURIComponent(POST_URN)) && url.endsWith("viewContext=AUTHOR"), respond: () => json(200, { id: POST_URN, lifecycleState }) }]).adapter.readbackPost(destination, POST_URN);
  assert.equal((await state("PUBLISHED")).kind, "published");
  assert.equal((await state("PUBLISH_REQUESTED")).kind, "processing");
  assert.equal((await state("PUBLISH_FAILED")).kind, "failed");
  const status = (code) => harness([{ match: () => true, respond: () => json(code, {}) }]).adapter.readbackPost(destination, POST_URN);
  assert.deepEqual(await status(404), { kind: "not_found", definitive: true });
  assert.deepEqual(await status(403), { kind: "not_found", definitive: false });
  assert.deepEqual(await status(500), { kind: "not_found", definitive: false });
});

test("find by client reference is unsupported and the content match is conservative", async () => {
  const since = "2026-10-13T12:00:00.000Z";
  const list = (elements, status = 200) => harness([{ match: (url) => url.includes("q=author") && url.includes(encodeURIComponent(destination.platformRef)), respond: () => json(status, { elements }) }]).adapter.findRecentCandidates(destination, textVariant, since);
  const { adapter } = harness([]);
  assert.deepEqual(await adapter.findByClientRef(destination, "client-ref"), { kind: "unsupported" });
  const created = Date.parse(since) + 5000;
  assert.equal((await list([{ id: POST_URN, commentary: "Sample text Post", createdAt: created, lifecycleState: "PUBLISHED" }])).kind, "published");
  assert.deepEqual(await list([{ id: POST_URN, commentary: "Different text", createdAt: created, lifecycleState: "PUBLISHED" }]), { kind: "not_found", definitive: false });
  assert.deepEqual(await list([{ id: POST_URN, commentary: "Sample text Post", createdAt: Date.parse(since) - 3_600_000, lifecycleState: "PUBLISHED" }]), { kind: "not_found", definitive: false }, "an older post with the same text is not this send");
  assert.deepEqual(await list([]), { kind: "not_found", definitive: false }, "an empty list is never proof the post is absent");
  assert.deepEqual(await list([], 403), { kind: "unsupported" }, "no read permission");
});

// ---- Independent review, 2026-10-13 (D7) ----

test("any success that names the post is a publish; anything unclear after the send is uncertain, never a clean failure", async () => {
  const published = (status) => ({ match: (url, method) => method === "POST" && url.endsWith("/rest/posts"), respond: () => json(status, null, { "x-restli-id": POST_URN }) });
  for (const status of [200, 201, 202]) {
    const { adapter } = harness([published(status)]);
    assert.equal((await adapter.createPost(destination, textVariant, "ref")).kind, "published", `status ${status}`);
  }
  const unclear = (status, body = null) => ({ match: (url, method) => method === "POST" && url.endsWith("/rest/posts"), respond: () => json(status, body) });
  for (const [status, body] of [[200, null], [202, null], [302, null], [408, null], [409, null], [500, null], [422, { code: "DUPLICATE_POST", message: "Content is a duplicate of a recent post." }]]) {
    const { adapter } = harness([unclear(status, body)]);
    assert.equal((await adapter.createPost(destination, textVariant, "ref")).kind, "uncertain", `status ${status}`);
  }
  const { adapter } = harness([unclear(422, { code: "FIELD_LENGTH_TOO_LONG", message: "commentary" })]);
  const outcome = await adapter.createPost(destination, textVariant, "ref");
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.retryable, false);
});

test("a bad answer to a video status poll keeps polling instead of failing the post", async () => {
  const routes = videoRoutes();
  let polls = 0;
  routes[3] = { match: (url, method) => method === "GET" && url.includes("/rest/videos/"), respond: () => (++polls === 1 ? json(503, null) : json(200, { id: VIDEO_URN, status: "AVAILABLE" })) };
  const { adapter } = harness([...routes, createOk]);
  assert.equal((await adapter.createPost(destination, videoVariant, "ref")).kind, "published");
  assert.equal(polls, 2);
});
