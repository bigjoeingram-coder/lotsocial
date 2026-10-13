import type { CapabilityManifest, DestinationRef, ErrorCode, LookupResult, Outcome, PlatformAdapter, UploadSession, VariantSnapshot } from "../adapter.ts";

// LinkedIn adapter. LotSocial-owned code written against the official LinkedIn REST API:
//   Posts API  https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api  (page dated 2026-05-07)
//   Videos API https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api (page dated 2026-02-12)
// Both pages were read on 2026-10-13. Nothing here has run against the live API yet,
// so every capability is marked DOCUMENTED_NOT_LIVE_TESTED and the adapter is not registered for production.
//
// What LinkedIn does not give us:
// - No client-supplied idempotency key on create, so findByClientRef is unsupported.
// - Listing a member's posts needs r_member_social, which LinkedIn restricts. Without it a lost
//   send cannot be confirmed either way and the slot goes to a person. That is the safe outcome.

export type LinkedInDeps = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  // Resolves the secret named by credentials_ref to a bearer token. The token never touches the database.
  getAccessToken: (credentialsRef: string) => Promise<string | null>;
  // Reads the rendered asset bytes for a storage key.
  readMedia: (mediaStorageKey: string) => Promise<ArrayBuffer | null>;
  // LinkedIn-Version header, YYYYMM. Versions are retired on a schedule, so this is configuration, not a constant.
  apiVersion: string;
  // Not stated on the Posts API page. 3000 is the commonly cited limit; LinkedIn answers 400 FIELD_LENGTH_TOO_LONG past the real one.
  maxCommentaryLength?: number;
  // Workers hold the file in memory during upload. LinkedIn itself allows 75 KB to 500 MB.
  maxVideoBytes?: number;
  videoStatusPolls?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const API = "https://api.linkedin.com/rest";
const MIN_VIDEO_BYTES = 75 * 1024;

type Failed = Extract<Outcome, { kind: "failed" }>;

export class LinkedInAdapter implements PlatformAdapter {
  private readonly deps: LinkedInDeps;

  constructor(deps: LinkedInDeps) {
    this.deps = deps;
  }

  getCapabilities(): CapabilityManifest {
    return {
      platform: "linkedin",
      features: {
        text: "DOCUMENTED_NOT_LIVE_TESTED", single_image: "UNSUPPORTED", video: "DOCUMENTED_NOT_LIVE_TESTED",
        native_schedule: "UNSUPPORTED", delete: "UNSUPPORTED", find_by_client_ref: "UNSUPPORTED",
      },
      maxTextLength: this.maxCommentary(),
      videoLimits: { maxBytes: this.maxVideoBytes(), maxSeconds: 30 * 60, aspectRatios: ["16:9", "1:1", "9:16"] },
      requiredFields: ["caption"],
    };
  }

  requiredScopes(operation: string) {
    const organization = operation.endsWith(":organization");
    if (operation.startsWith("read")) return [organization ? "r_organization_social" : "r_member_social"];
    return [organization ? "w_organization_social" : "w_member_social"];
  }

  validateContent(variant: VariantSnapshot) {
    const errors: string[] = [];
    if (!variant.caption.trim()) errors.push("LinkedIn needs post text.");
    if (variant.caption.length > this.maxCommentary()) errors.push(`The post text is longer than ${this.maxCommentary()} characters.`);
    if (variant.mediaStorageKey && !/\.mp4$/i.test(variant.mediaStorageKey)) errors.push("LinkedIn video must be an MP4 file.");
    return errors.length ? { ok: false as const, errors } : { ok: true as const };
  }

  async healthCheck(destination: DestinationRef) {
    const token = await this.deps.getAccessToken(destination.credentialsRef);
    if (!token) return { state: "AUTH_REQUIRED" as const, detail: "No LinkedIn token is stored for this connection." };
    return { state: "UNVERIFIED" as const, detail: "A token is present. It has not been checked against LinkedIn." };
  }

  async getRateBudget() {
    return null;
  }

  // The upload runs inside createPost, because LinkedIn's part URLs expire and the video URN is only
  // useful to the post that follows. These four are part of the shared contract and are not used on their own.
  async beginMediaUpload(_destination: DestinationRef, mediaStorageKey: string): Promise<UploadSession> {
    return { sessionId: "", mediaRef: mediaStorageKey, nextIndex: 0, complete: false };
  }

  async uploadMediaChunk(session: UploadSession): Promise<UploadSession> {
    return session;
  }

  async getMediaProcessingStatus(destination: DestinationRef, mediaRef: string) {
    const token = await this.deps.getAccessToken(destination.credentialsRef);
    if (!token) return { state: "failed" as const, detail: "No LinkedIn token is stored for this connection." };
    const response = await this.deps.fetch(`${API}/videos/${encodeURIComponent(mediaRef)}`, { method: "GET", headers: this.headers(token) });
    // A bad answer to a status poll is not a verdict on the video. Keep polling; the poll budget is the limit.
    if (!response.ok) return { state: "processing" as const, detail: `LinkedIn answered ${response.status} to the status poll.` };
    const status = String((await response.json() as { status?: string }).status ?? "");
    if (status === "AVAILABLE") return { state: "ready" as const, detail: status };
    if (status === "PROCESSING_FAILED") return { state: "failed" as const, detail: status };
    return { state: "processing" as const, detail: status };
  }

  async cancelMediaUpload() {}

  async createPost(destination: DestinationRef, variant: VariantSnapshot): Promise<Outcome> {
    const token = await this.deps.getAccessToken(destination.credentialsRef);
    if (!token) return failed("AUTH_REQUIRED", "No LinkedIn token is stored for this connection.", false);

    let videoUrn = "";
    if (variant.mediaStorageKey) {
      // Everything in this block happens before the post exists, so a failure here is never an uncertain write.
      const upload = await this.uploadVideo(destination, variant, token);
      if (typeof upload !== "string") return upload;
      videoUrn = upload;
    }

    const body: Record<string, unknown> = {
      author: destination.platformRef,
      commentary: variant.caption,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    if (videoUrn) body.content = { media: { title: variant.title || variant.caption.slice(0, 80), id: videoUrn } };

    // From here the write may or may not land. A network error is thrown to the dispatcher, which records it as uncertain.
    const response = await this.deps.fetch(`${API}/posts`, { method: "POST", headers: this.headers(token, true), body: JSON.stringify(body) });
    const postUrn = response.headers.get("x-restli-id") ?? "";
    // Any success that names the post is a publish. The documented answer is 201, but a 200 or 202 with an id is still the post.
    if (response.ok && postUrn) {
      return { kind: "published", platformPostId: postUrn, platformUrl: postUrl(postUrn), providerRequestId: response.headers.get("x-li-uuid") ?? undefined };
    }
    // After the request was sent, only a clear 4xx proves the post was not created.
    // A success without an id, a redirect, a timeout, a conflict, a duplicate complaint, or a server error leaves it unknown.
    if (response.ok || response.status >= 500 || (response.status >= 300 && response.status < 400) || response.status === 408 || response.status === 409) {
      return { kind: "uncertain", detail: `LinkedIn answered ${response.status} to the create request${postUrn ? "" : " without a post id"}.` };
    }
    const failure = await failedFromResponse(response);
    if (/duplicate/i.test(failure.message)) return { kind: "uncertain", detail: `LinkedIn reports a duplicate: ${failure.message}` };
    return failure;
  }

  async readbackPost(destination: DestinationRef, platformPostId: string): Promise<LookupResult> {
    const token = await this.deps.getAccessToken(destination.credentialsRef);
    if (!token) return { kind: "not_found", definitive: false };
    const response = await this.deps.fetch(`${API}/posts/${encodeURIComponent(platformPostId)}?viewContext=AUTHOR`, { method: "GET", headers: this.headers(token) });
    if (response.status === 404) return { kind: "not_found", definitive: true };
    if (!response.ok) return { kind: "not_found", definitive: false };
    const post = await response.json() as { id?: string; lifecycleState?: string };
    const id = post.id || platformPostId;
    if (post.lifecycleState === "PUBLISHED") return { kind: "published", platformPostId: id, platformUrl: postUrl(id) };
    if (post.lifecycleState === "PUBLISH_FAILED") return { kind: "failed", code: "PLATFORM_REJECTED", message: "LinkedIn reports the post failed to publish." };
    return { kind: "processing", platformPostId: id };
  }

  async findByClientRef(): Promise<LookupResult> {
    return { kind: "unsupported" };
  }

  // Lists the author's recent posts and looks for the exact text, created after the send started.
  // A miss is never treated as proof: the list can lag, and the engine must not re-send on a guess.
  async findRecentCandidates(destination: DestinationRef, variant: VariantSnapshot, sinceIso: string): Promise<LookupResult> {
    const token = await this.deps.getAccessToken(destination.credentialsRef);
    if (!token) return { kind: "not_found", definitive: false };
    const url = `${API}/posts?author=${encodeURIComponent(destination.platformRef)}&q=author&count=20&sortBy=CREATED&viewContext=AUTHOR`;
    const response = await this.deps.fetch(url, { method: "GET", headers: this.headers(token) });
    // 403 here means the read permission is not granted, which is normal for member posting.
    if (response.status === 403) return { kind: "unsupported" };
    if (!response.ok) return { kind: "not_found", definitive: false };
    const since = Date.parse(sinceIso) - 60_000;
    const elements = (await response.json() as { elements?: { id?: string; commentary?: string; createdAt?: number; lifecycleState?: string }[] }).elements ?? [];
    const match = elements.find((post) => post.id && post.commentary === variant.caption && Number(post.createdAt ?? 0) >= since);
    if (!match?.id) return { kind: "not_found", definitive: false };
    if (match.lifecycleState === "PUBLISHED") return { kind: "published", platformPostId: match.id, platformUrl: postUrl(match.id) };
    if (match.lifecycleState === "PUBLISH_FAILED") return { kind: "failed", code: "PLATFORM_REJECTED", message: "LinkedIn reports the post failed to publish." };
    return { kind: "processing", platformPostId: match.id };
  }

  private async uploadVideo(destination: DestinationRef, variant: VariantSnapshot, token: string): Promise<string | Failed> {
    const bytes = await this.deps.readMedia(variant.mediaStorageKey);
    if (!bytes) return failed("VALIDATION", "The rendered video could not be read.", false);
    if (bytes.byteLength < MIN_VIDEO_BYTES || bytes.byteLength > this.maxVideoBytes()) {
      return failed("VALIDATION", `The video is ${bytes.byteLength} bytes. The allowed range is ${MIN_VIDEO_BYTES} to ${this.maxVideoBytes()}.`, false);
    }

    const initialized = await this.deps.fetch(`${API}/videos?action=initializeUpload`, {
      method: "POST", headers: this.headers(token, true),
      body: JSON.stringify({ initializeUploadRequest: { owner: destination.platformRef, fileSizeBytes: bytes.byteLength, uploadCaptions: false, uploadThumbnail: false } }),
    });
    if (!initialized.ok) return await failedFromResponse(initialized);
    const value = (await initialized.json() as { value?: { video?: string; uploadToken?: string; uploadInstructions?: { uploadUrl: string; firstByte: number; lastByte: number }[] } }).value;
    if (!value?.video || !value.uploadInstructions?.length) return failed("TRANSIENT_PROVIDER", "LinkedIn did not return upload instructions.", true);

    const partIds: string[] = [];
    for (const part of value.uploadInstructions) {
      const uploaded = await this.deps.fetch(part.uploadUrl, {
        method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes.slice(part.firstByte, part.lastByte + 1),
      });
      const etag = uploaded.headers.get("etag") ?? "";
      if (!uploaded.ok || !etag) return failed("TRANSIENT_PROVIDER", `A video part failed to upload (${uploaded.status}).`, true);
      partIds.push(etag);
    }

    const finalized = await this.deps.fetch(`${API}/videos?action=finalizeUpload`, {
      method: "POST", headers: this.headers(token, true),
      body: JSON.stringify({ finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken ?? "", uploadedPartIds: partIds } }),
    });
    if (!finalized.ok) return await failedFromResponse(finalized);

    const polls = this.deps.videoStatusPolls ?? 10;
    for (let attempt = 0; attempt < polls; attempt += 1) {
      const status = await this.getMediaProcessingStatus(destination, value.video);
      if (status.state === "ready") return value.video;
      if (status.state === "failed") return failed("PLATFORM_REJECTED", `LinkedIn could not process the video (${status.detail}).`, false);
      await (this.deps.sleep ?? defaultSleep)(3000);
    }
    return failed("MEDIA_PROCESSING", "LinkedIn is still processing the video.", true, 120);
  }

  private headers(token: string, json = false): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Linkedin-Version": this.deps.apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
    };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  private maxCommentary() {
    return this.deps.maxCommentaryLength ?? 3000;
  }

  private maxVideoBytes() {
    return this.deps.maxVideoBytes ?? 100 * 1024 * 1024;
  }
}

function postUrl(postUrn: string) {
  return `https://www.linkedin.com/feed/update/${postUrn}/`;
}

function failed(code: ErrorCode, message: string, retryable: boolean, retryAfterSeconds?: number): Failed {
  return { kind: "failed", code, message, retryable, retryAfterSeconds };
}

// Status codes as documented on the Posts API page.
async function failedFromResponse(response: Response): Promise<Failed> {
  let detail = "";
  try {
    const body = await response.json() as { message?: string; code?: string };
    detail = [body.code, body.message].filter(Boolean).join(": ");
  } catch {
    detail = "";
  }
  const message = `LinkedIn answered ${response.status}${detail ? ` (${detail})` : ""}.`;
  const retryAfter = Number(response.headers.get("retry-after") ?? "");
  if (response.status === 401) return failed("AUTH_REQUIRED", message, false);
  if (response.status === 403) return failed("PERMISSION_DENIED", message, false);
  if (response.status === 429) return failed("RATE_LIMITED", message, true, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  if (response.status === 409) return failed("TRANSIENT_PROVIDER", message, true);
  if (response.status === 400 || response.status === 422) return failed("VALIDATION", message, false);
  if (response.status >= 500) return failed("TRANSIENT_PROVIDER", message, true);
  return failed("PLATFORM_REJECTED", message, false);
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
