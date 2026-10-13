import type { CapabilityManifest, DestinationRef, ErrorCode, LookupResult, MediaStatus, Outcome, PlatformAdapter, UploadSession, VariantSnapshot } from "../adapter.ts";

// YouTube adapter. LotSocial-owned code written against the official YouTube Data API v3:
//   Resumable uploads https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol (page dated 2026-09-14)
//   videos.insert     https://developers.google.com/youtube/v3/docs/videos/insert                     (page dated 2026-10-08)
//   videos.list       https://developers.google.com/youtube/v3/docs/videos/list                       (page dated 2026-09-14)
//   video resource    https://developers.google.com/youtube/v3/docs/videos                            (page dated 2026-10-08)
// All four pages were read on 2026-10-13. Nothing here has run against the live API yet,
// so every capability is marked DOCUMENTED_NOT_LIVE_TESTED and the adapter is not registered for production.
//
// What YouTube gives us that LinkedIn does not:
// - The resumable session can be asked "did my upload finish?". A 308 answer proves no video exists yet,
//   so an interrupted upload is resolved inside createPost instead of being left uncertain.
// What it does not give us:
// - No client-supplied idempotency key, so findByClientRef is unsupported.
// - The session URI is not stored between runs. If the Worker dies mid-upload the slot goes to a person.

export type YouTubeDeps = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  // Resolves the secret named by credentials_ref to a bearer token. The token never touches the database.
  getAccessToken: (credentialsRef: string) => Promise<string | null>;
  // Reads the rendered asset bytes for a storage key.
  readMedia: (mediaStorageKey: string) => Promise<ArrayBuffer | null>;
  // Workers hold the file in memory during upload. YouTube itself allows 256 GB.
  maxVideoBytes?: number;
  // How many times an interrupted upload is checked and resumed before giving up.
  resumeAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";
const API = "https://www.googleapis.com/youtube/v3/videos";
const MAX_TITLE = 100;
const MAX_DESCRIPTION_BYTES = 5000;
const PRIVACY = ["public", "unlisted", "private"];

type Failed = Extract<Outcome, { kind: "failed" }>;
type VideoResource = { id?: string; status?: { uploadStatus?: string; privacyStatus?: string; failureReason?: string; rejectionReason?: string } };

export class YouTubeAdapter implements PlatformAdapter {
  private readonly deps: YouTubeDeps;

  constructor(deps: YouTubeDeps) {
    this.deps = deps;
  }

  getCapabilities(): CapabilityManifest {
    return {
      platform: "youtube",
      features: {
        text: "UNSUPPORTED", single_image: "UNSUPPORTED", video: "DOCUMENTED_NOT_LIVE_TESTED",
        native_schedule: "UNSUPPORTED", delete: "UNSUPPORTED", find_by_client_ref: "UNSUPPORTED",
      },
      maxTextLength: MAX_DESCRIPTION_BYTES,
      // maxSeconds is not on the pages read. 15 minutes is the conservative limit for accounts without long uploads enabled.
      videoLimits: { maxBytes: this.maxVideoBytes(), maxSeconds: 15 * 60, aspectRatios: ["16:9", "9:16", "1:1"] },
      requiredFields: ["title", "media"],
    };
  }

  // The upload scope is stated on the videos.insert page. The read scope is not stated on the videos.list page;
  // youtube.readonly is the expected one and must be confirmed in the credential inventory.
  requiredScopes(operation: string) {
    if (operation.startsWith("read")) return ["https://www.googleapis.com/auth/youtube.readonly"];
    return ["https://www.googleapis.com/auth/youtube.upload"];
  }

  validateContent(variant: VariantSnapshot) {
    const errors: string[] = [];
    const title = variant.title.trim();
    const description = descriptionOf(variant);
    if (!title) errors.push("YouTube needs a video title.");
    if (title.length > MAX_TITLE) errors.push(`The title is longer than ${MAX_TITLE} characters.`);
    if (/[<>]/.test(title)) errors.push("The title cannot contain < or >.");
    if (new TextEncoder().encode(description).byteLength > MAX_DESCRIPTION_BYTES) errors.push(`The description is longer than ${MAX_DESCRIPTION_BYTES} bytes.`);
    if (/[<>]/.test(description)) errors.push("The description cannot contain < or >.");
    if (!variant.mediaStorageKey) errors.push("YouTube needs a video file.");
    else if (!/\.mp4$/i.test(variant.mediaStorageKey)) errors.push("YouTube video must be an MP4 file.");
    const privacy = variant.platformOptions.privacyStatus;
    if (privacy !== undefined && !PRIVACY.includes(String(privacy))) errors.push("Privacy must be public, unlisted or private.");
    return errors.length ? { ok: false as const, errors } : { ok: true as const };
  }

  async healthCheck(destination: DestinationRef) {
    const token = await this.deps.getAccessToken(destination.credentialsRef);
    if (!token) return { state: "AUTH_REQUIRED" as const, detail: "No YouTube token is stored for this connection." };
    return { state: "UNVERIFIED" as const, detail: "A token is present. It has not been checked against YouTube." };
  }

  // videos.insert has its own bucket: 100 calls per day. The API does not report what is left.
  async getRateBudget() {
    return null;
  }

  // The upload runs inside createPost, because finishing the upload is what creates the video.
  // These are part of the shared contract and are not used on their own.
  async beginMediaUpload(_destination: DestinationRef, mediaStorageKey: string): Promise<UploadSession> {
    return { sessionId: "", mediaRef: mediaStorageKey, nextIndex: 0, complete: false };
  }

  async uploadMediaChunk(session: UploadSession): Promise<UploadSession> {
    return session;
  }

  async getMediaProcessingStatus(destination: DestinationRef, mediaRef: string): Promise<MediaStatus> {
    const result = await this.readbackPost(destination, mediaRef);
    if (result.kind === "published") return { state: "ready", detail: "processed" };
    if (result.kind === "processing") return { state: "processing", detail: "uploaded" };
    if (result.kind === "failed") return { state: "failed", detail: result.message };
    return { state: "failed", detail: "YouTube did not return the video." };
  }

  async cancelMediaUpload() {}

  async createPost(destination: DestinationRef, variant: VariantSnapshot): Promise<Outcome> {
    const token = await this.deps.getAccessToken(destination.credentialsRef);
    if (!token) return failed("AUTH_REQUIRED", "No YouTube token is stored for this connection.", false);
    const valid = this.validateContent(variant);
    if (!valid.ok) return failed("VALIDATION", valid.errors.join(" "), false);

    const bytes = await this.deps.readMedia(variant.mediaStorageKey);
    if (!bytes) return failed("VALIDATION", "The rendered video could not be read.", false);
    if (bytes.byteLength === 0 || bytes.byteLength > this.maxVideoBytes()) {
      return failed("VALIDATION", `The video is ${bytes.byteLength} bytes. The allowed maximum is ${this.maxVideoBytes()}.`, false);
    }
    const total = bytes.byteLength;
    const wantedPrivacy = String(variant.platformOptions.privacyStatus ?? "public");

    // Step 1: open the session. No video exists until the bytes are fully received, so a failure here is definite.
    const metadata = {
      snippet: { title: variant.title.trim(), description: descriptionOf(variant), categoryId: String(variant.platformOptions.categoryId ?? "22") },
      status: { privacyStatus: wantedPrivacy, selfDeclaredMadeForKids: variant.platformOptions.madeForKids === true },
    };
    const opened = await this.deps.fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(total), "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(metadata),
    });
    if (!opened.ok) return await failedFromResponse(opened);
    const sessionUri = opened.headers.get("location") ?? "";
    if (!sessionUri) return failed("TRANSIENT_PROVIDER", "YouTube did not return an upload session.", true);

    // Step 2: send the file. From here the video may or may not exist, so every unclear answer is checked with the session.
    // Once bytes have been sent, only two answers prove anything: a video resource (created) or 308 (incomplete).
    // Everything else, from either the upload answer or a status check, leaves the result unknown.
    let response = await this.put(sessionUri, token, { "Content-Type": "video/mp4" }, bytes);
    const attempts = this.deps.resumeAttempts ?? 2;
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      const settled = response ? await this.settle(response, wantedPrivacy, true) : null;
      if (settled) return settled;

      // Interrupted or unclear. Ask the session how far it got.
      await (this.deps.sleep ?? defaultSleep)(1000 * 2 ** attempt);
      const status = await this.put(sessionUri, token, { "Content-Range": `bytes */${total}` }, null);
      if (!status) { response = null; continue; }
      if (status.status !== 308) {
        // A status check can settle only with a video resource. Any other code is noise, not a verdict.
        const fromStatus = await this.settle(status, wantedPrivacy, false);
        if (fromStatus) return fromStatus;
        response = null;
        continue;
      }

      // 308 proves the upload is incomplete and no video exists.
      if (attempt === attempts) return failed("TRANSIENT_PROVIDER", "The upload to YouTube was interrupted and did not finish. No video was created.", true);
      const received = /bytes=0-(\d+)/.exec(status.headers.get("range") ?? "");
      const next = received ? Number(received[1]) + 1 : 0;
      response = await this.put(sessionUri, token, { "Content-Type": "video/mp4", "Content-Range": `bytes ${next}-${total - 1}/${total}` }, bytes.slice(next));
    }
    const last = response ? await this.settle(response, wantedPrivacy, true) : null;
    return last ?? { kind: "uncertain", detail: "YouTube did not confirm whether the upload finished." };
  }

  async readbackPost(destination: DestinationRef, platformPostId: string): Promise<LookupResult> {
    const token = await this.deps.getAccessToken(destination.credentialsRef);
    if (!token) return { kind: "not_found", definitive: false };
    const response = await this.deps.fetch(`${API}?part=status&id=${encodeURIComponent(platformPostId)}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return { kind: "not_found", definitive: false };
    const video = ((await response.json() as { items?: VideoResource[] }).items ?? [])[0];
    // An empty list can mean deleted, or simply not visible to this token yet. It is not proof.
    if (!video) return { kind: "not_found", definitive: false };
    const status = video.status?.uploadStatus;
    if (status === "processed") return { kind: "published", platformPostId, platformUrl: watchUrl(platformPostId) };
    if (status === "uploaded") return { kind: "processing", platformPostId };
    if (status === "deleted") return { kind: "not_found", definitive: true };
    if (status === "failed" || status === "rejected") return { kind: "failed", code: "PLATFORM_REJECTED", message: rejection(video) };
    return { kind: "not_found", definitive: false };
  }

  async findByClientRef(): Promise<LookupResult> {
    return { kind: "unsupported" };
  }

  // Listing a channel's uploads is a different API method that has not been read or built.
  async findRecentCandidates(): Promise<LookupResult> {
    return { kind: "unsupported" };
  }

  // Turns an answer into an outcome. Returns null when the answer does not settle anything.
  // `direct` is the answer to an upload PUT; a status-check answer can settle only with a video resource.
  private async settle(response: Response, wantedPrivacy: string, direct: boolean): Promise<Outcome | null> {
    if (response.status === 200 || response.status === 201) {
      let video: VideoResource = {};
      try { video = await response.json() as VideoResource; } catch { video = {}; }
      if (!video.id) return { kind: "uncertain", detail: `YouTube answered ${response.status} without a video id.` };
      // The video exists from here on. Its id is never dropped: a wrong privacy or a rejection is reported
      // on the post, and the readback decides what happens to it.
      const status = video.status?.uploadStatus;
      const privacy = video.status?.privacyStatus;
      let warning: string | undefined;
      if (status === "failed" || status === "rejected") warning = rejection(video);
      else if (privacy && privacy !== wantedPrivacy) warning = `YouTube created video ${video.id} as ${privacy}, not ${wantedPrivacy}. Change it in YouTube Studio.`;
      if (status === "processed") return { kind: "published", platformPostId: video.id, platformUrl: watchUrl(video.id), ...(warning ? { warning } : {}) };
      return { kind: "processing", platformPostId: video.id, ...(warning ? { warning } : {}) };
    }
    if (!direct) return null;
    if (response.status >= 500 || response.status === 308) return null;
    // The documented meaning of a 4xx to the upload itself is a permanent failure. A timeout or a rate
    // limit is not that: the bytes may have been received, so those stay unsettled and go to the session check.
    if (response.status === 408 || response.status === 429) return null;
    // An expired session. The upload must start again from the beginning.
    if (response.status === 404) return failed("TRANSIENT_PROVIDER", "The YouTube upload session expired. No video was created.", true);
    return await failedFromResponse(response);
  }

  // A network error returns null so the caller checks the session instead of guessing.
  private async put(url: string, token: string, headers: Record<string, string>, body: ArrayBuffer | null): Promise<Response | null> {
    try {
      return await this.deps.fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${token}`, ...headers }, body });
    } catch {
      return null;
    }
  }

  private maxVideoBytes() {
    return this.deps.maxVideoBytes ?? 100 * 1024 * 1024;
  }
}

function descriptionOf(variant: VariantSnapshot) {
  return variant.description || variant.caption;
}

function watchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function rejection(video: VideoResource) {
  const reason = video.status?.rejectionReason || video.status?.failureReason || "no reason given";
  return `YouTube ${video.status?.uploadStatus} the video (${reason}).`;
}

function failed(code: ErrorCode, message: string, retryable: boolean, retryAfterSeconds?: number): Failed {
  return { kind: "failed", code, message, retryable, retryAfterSeconds };
}

// Error reasons as listed on the videos.insert page, in Google's standard error body.
async function failedFromResponse(response: Response): Promise<Failed> {
  let reason = "";
  let detail = "";
  try {
    const body = await response.json() as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = body.error?.errors?.[0]?.reason ?? "";
    detail = [reason, body.error?.message].filter(Boolean).join(": ");
  } catch {
    detail = "";
  }
  const message = `YouTube answered ${response.status}${detail ? ` (${detail})` : ""}.`;
  const retryAfter = Number(response.headers.get("retry-after") ?? "");
  const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
  if (response.status === 401) return failed("AUTH_REQUIRED", message, false);
  // The daily upload allowance. It comes back on its own, so wait rather than fail.
  if (reason === "uploadLimitExceeded" || reason === "quotaExceeded" || reason === "rateLimitExceeded" || response.status === 429) {
    return failed("RATE_LIMITED", message, true, wait ?? 3600);
  }
  if (response.status === 403) return failed("PERMISSION_DENIED", message, false);
  if (response.status === 400) return failed("VALIDATION", message, false);
  if (response.status >= 500) return failed("TRANSIENT_PROVIDER", message, true);
  return failed("PLATFORM_REJECTED", message, false);
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
