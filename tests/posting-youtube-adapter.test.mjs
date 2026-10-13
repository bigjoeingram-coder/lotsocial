import assert from "node:assert/strict";
import test from "node:test";
import { YouTubeAdapter } from "../app/lib/posting/adapters/youtube.ts";
import { PRODUCTION_ADAPTERS } from "../app/lib/posting-tick-handler.ts";

// Fixtures follow the sample requests and responses on the official YouTube Data API pages
// (resumable upload guide, videos.insert, videos.list, video resource; read 2026-10-13). No test calls YouTube.
const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=xa298sd_f&part=snippet,status";
const VIDEO_ID = "Ks-_Mh1QhMc";
const SIZE = 3000;
const destination = { id: "dest-1", platform: "youtube", platformRef: "UC_x5XG1OV2P6uZZ5FSM9Ttw", kind: "channel", connectionId: "conn-1", credentialsRef: "YOUTUBE_TOKEN_JOE" };
const variant = { variantId: "v1", platform: "youtube", caption: "", title: "My video title", description: "This is a description of my video", platformOptions: {}, mediaStorageKey: "renders/proj-1.mp4", revisionHash: "hash-1" };

function json(status, body, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
const created = (uploadStatus = "uploaded", privacyStatus = "public", extra = {}) => json(201, { kind: "youtube#video", id: VIDEO_ID, status: { uploadStatus, privacyStatus, ...extra } });
const opened = () => new Response(null, { status: 200, headers: { location: SESSION } });
const incomplete = (range) => new Response(null, { status: 308, headers: range ? { range } : {} });
const googleError = (status, reason, headers = {}) => json(status, { error: { code: status, message: "sample message", errors: [{ domain: "youtube.video", reason }] } }, headers);

// Answers each request from a script, in order, and records what was sent. A step may throw to act as a dropped connection.
function harness(steps, overrides = {}) {
  const calls = [];
  const adapter = new YouTubeAdapter({
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
      const step = steps[calls.length - 1];
      if (!step) throw new Error(`Unexpected request ${calls.length}: ${init.method} ${url}`);
      return step();
    },
    getAccessToken: async (ref) => (ref === "YOUTUBE_TOKEN_JOE" ? "test-token" : null),
    readMedia: async () => new ArrayBuffer(SIZE),
    sleep: async () => {},
    ...overrides,
  });
  return { adapter, calls };
}
const dropped = () => { throw new Error("connection reset"); };

test("the YouTube adapter is not registered for production", () => {
  assert.equal("youtube" in PRODUCTION_ADAPTERS, false);
});

test("every YouTube capability is unverified or unsupported, and the upload scope matches the docs", () => {
  const { adapter } = harness([]);
  const manifest = adapter.getCapabilities();
  assert.ok(!Object.values(manifest.features).includes("VERIFIED_LIVE"));
  assert.equal(manifest.features.video, "DOCUMENTED_NOT_LIVE_TESTED");
  assert.equal(manifest.features.text, "UNSUPPORTED");
  assert.equal(manifest.features.find_by_client_ref, "UNSUPPORTED");
  assert.deepEqual(adapter.requiredScopes("post"), ["https://www.googleapis.com/auth/youtube.upload"]);
});

test("validation enforces the documented title and description limits before any request", async () => {
  const { adapter, calls } = harness([]);
  assert.equal(adapter.validateContent(variant).ok, true);
  assert.equal(adapter.validateContent({ ...variant, title: " " }).ok, false);
  assert.equal(adapter.validateContent({ ...variant, title: "x".repeat(101) }).ok, false);
  assert.equal(adapter.validateContent({ ...variant, title: "a <b>" }).ok, false);
  assert.equal(adapter.validateContent({ ...variant, description: "é".repeat(2501) }).ok, false);
  assert.equal(adapter.validateContent({ ...variant, description: "é".repeat(2500) }).ok, true);
  assert.equal(adapter.validateContent({ ...variant, mediaStorageKey: "" }).ok, false);
  assert.equal(adapter.validateContent({ ...variant, platformOptions: { privacyStatus: "secret" } }).ok, false);
  const outcome = await adapter.createPost(destination, { ...variant, title: "" }, "ref");
  assert.equal(outcome.code, "VALIDATION");
  assert.equal(calls.length, 0);
});

test("an upload opens a session with the documented request, sends the file, and reports processing", async () => {
  const { adapter, calls } = harness([opened, () => created("uploaded")]);
  const outcome = await adapter.createPost(destination, variant, "ref");
  assert.deepEqual(outcome, { kind: "processing", platformPostId: VIDEO_ID });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status");
  assert.equal(calls[0].headers.Authorization, "Bearer test-token");
  assert.equal(calls[0].headers["Content-Type"], "application/json; charset=UTF-8");
  assert.equal(calls[0].headers["X-Upload-Content-Length"], String(SIZE));
  assert.equal(calls[0].headers["X-Upload-Content-Type"], "video/mp4");
  assert.deepEqual(JSON.parse(calls[0].body), {
    snippet: { title: "My video title", description: "This is a description of my video", categoryId: "22" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  });
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[1].url, SESSION);
  assert.equal(calls[1].body.byteLength, SIZE);
});

test("a processed video is published with its watch link", async () => {
  const { adapter } = harness([opened, () => created("processed")]);
  assert.deepEqual(await adapter.createPost(destination, variant, "ref"), { kind: "published", platformPostId: VIDEO_ID, platformUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}` });
});

test("a failure to open the session is a clean failure, because no video can exist yet", async () => {
  for (const [step, code, retryable] of [
    [() => googleError(401, "authError"), "AUTH_REQUIRED", false],
    [() => googleError(403, "forbidden"), "PERMISSION_DENIED", false],
    [() => googleError(400, "invalidTitle"), "VALIDATION", false],
    [() => googleError(400, "uploadLimitExceeded"), "RATE_LIMITED", true],
    [() => googleError(403, "quotaExceeded"), "RATE_LIMITED", true],
    [() => googleError(503, "backendError"), "TRANSIENT_PROVIDER", true],
    [() => new Response(null, { status: 200 }), "TRANSIENT_PROVIDER", true],
  ]) {
    const { adapter, calls } = harness([step]);
    const outcome = await adapter.createPost(destination, variant, "ref");
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.code, code);
    assert.equal(outcome.retryable, retryable);
    assert.equal(calls.length, 1);
  }
});

test("a dropped connection is checked with the session and the upload resumes from the confirmed byte", async () => {
  const { adapter, calls } = harness([opened, dropped, () => incomplete("bytes=0-999"), () => created("uploaded")]);
  const outcome = await adapter.createPost(destination, variant, "ref");
  assert.deepEqual(outcome, { kind: "processing", platformPostId: VIDEO_ID });
  assert.equal(calls[2].headers["Content-Range"], `bytes */${SIZE}`);
  assert.equal(calls[2].body, null);
  assert.equal(calls[3].headers["Content-Range"], `bytes 1000-${SIZE - 1}/${SIZE}`);
  assert.equal(calls[3].body.byteLength, SIZE - 1000);
});

test("a 308 with no Range header restarts from byte zero", async () => {
  const { adapter, calls } = harness([opened, () => googleError(503, "backendError"), () => incomplete(), () => created("uploaded")]);
  assert.equal((await adapter.createPost(destination, variant, "ref")).kind, "processing");
  assert.equal(calls[3].headers["Content-Range"], `bytes 0-${SIZE - 1}/${SIZE}`);
});

test("an upload that finished despite a dropped connection is found, not sent again", async () => {
  const { adapter, calls } = harness([opened, dropped, () => created("uploaded")]);
  assert.deepEqual(await adapter.createPost(destination, variant, "ref"), { kind: "processing", platformPostId: VIDEO_ID });
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((call) => call.body && call.method === "PUT").length, 1);
});

test("an upload confirmed incomplete after the last attempt is a retryable failure, not uncertain", async () => {
  const { adapter } = harness([opened, dropped, () => incomplete("bytes=0-99"), dropped, () => incomplete("bytes=0-99")], { resumeAttempts: 1 });
  const outcome = await adapter.createPost(destination, variant, "ref");
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.code, "TRANSIENT_PROVIDER");
  assert.equal(outcome.retryable, true);
});

test("when the session cannot be reached at all the result is uncertain, never a clean failure", async () => {
  const { adapter } = harness([opened, dropped, dropped, dropped], { resumeAttempts: 1 });
  assert.equal((await adapter.createPost(destination, variant, "ref")).kind, "uncertain");
  const second = harness([opened, () => json(201, { kind: "youtube#video" })]);
  assert.equal((await second.adapter.createPost(destination, variant, "ref")).kind, "uncertain");
});

test("an expired session is a retryable failure", async () => {
  const { adapter } = harness([opened, () => googleError(404, "notFound")]);
  const outcome = await adapter.createPost(destination, variant, "ref");
  assert.equal(outcome.code, "TRANSIENT_PROVIDER");
  assert.equal(outcome.retryable, true);
});

test("a video YouTube rejects, or keeps private against the request, is a failure that names the video", async () => {
  const rejected = harness([opened, () => created("rejected", "public", { rejectionReason: "duplicate" })]);
  const first = await rejected.adapter.createPost(destination, variant, "ref");
  assert.equal(first.code, "PLATFORM_REJECTED");
  assert.match(first.message, /duplicate/);
  const lockedPrivate = harness([opened, () => created("uploaded", "private")]);
  const second = await lockedPrivate.adapter.createPost(destination, variant, "ref");
  assert.equal(second.code, "PLATFORM_REJECTED");
  assert.equal(second.retryable, false);
  assert.match(second.message, new RegExp(VIDEO_ID));
  const askedPrivate = harness([opened, () => created("processed", "private")]);
  assert.equal((await askedPrivate.adapter.createPost(destination, { ...variant, platformOptions: { privacyStatus: "private" } }, "ref")).kind, "published");
});

test("a missing token or unreadable or oversized file fails with no request sent", async () => {
  const noToken = harness([]);
  assert.equal((await noToken.adapter.createPost({ ...destination, credentialsRef: "OTHER" }, variant, "ref")).code, "AUTH_REQUIRED");
  const noFile = harness([], { readMedia: async () => null });
  assert.equal((await noFile.adapter.createPost(destination, variant, "ref")).code, "VALIDATION");
  const tooBig = harness([], { maxVideoBytes: SIZE - 1 });
  assert.equal((await tooBig.adapter.createPost(destination, variant, "ref")).code, "VALIDATION");
  assert.equal(noToken.calls.length + noFile.calls.length + tooBig.calls.length, 0);
});

test("readback maps upload states and treats only a deleted video as a definitive miss", async () => {
  const list = (items) => () => json(200, { kind: "youtube#videoListResponse", items });
  const item = (uploadStatus, extra = {}) => [{ id: VIDEO_ID, status: { uploadStatus, privacyStatus: "public", ...extra } }];
  const read = async (step) => {
    const { adapter, calls } = harness([step]);
    const result = await adapter.readbackPost(destination, VIDEO_ID);
    assert.equal(calls[0].url, `https://www.googleapis.com/youtube/v3/videos?part=status&id=${VIDEO_ID}`);
    return result;
  };
  assert.deepEqual(await read(list(item("processed"))), { kind: "published", platformPostId: VIDEO_ID, platformUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}` });
  assert.deepEqual(await read(list(item("uploaded"))), { kind: "processing", platformPostId: VIDEO_ID });
  assert.equal((await read(list(item("failed", { failureReason: "codec" })))).kind, "failed");
  assert.deepEqual(await read(list(item("deleted"))), { kind: "not_found", definitive: true });
  assert.deepEqual(await read(list([])), { kind: "not_found", definitive: false });
  assert.deepEqual(await read(() => googleError(500, "backendError")), { kind: "not_found", definitive: false });
});

test("lookups without a known video id are unsupported, so a lost upload goes to a person", async () => {
  const { adapter, calls } = harness([]);
  assert.deepEqual(await adapter.findByClientRef(destination, "ref"), { kind: "unsupported" });
  assert.deepEqual(await adapter.findRecentCandidates(destination, variant, "2026-10-13T00:00:00Z"), { kind: "unsupported" });
  assert.equal(calls.length, 0);
});
