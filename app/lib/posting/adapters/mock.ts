import type { CapabilityManifest, DestinationRef, LookupResult, Outcome, PlatformAdapter, VariantSnapshot } from "../adapter.ts";

// Deterministic adapter for tests. It keeps a fake "platform" in memory and
// follows a script of outcomes, so every failure mode can be replayed exactly.
export type MockStep =
  | { kind: "publish" }
  | { kind: "processing"; readyAfterChecks?: number }
  | { kind: "accept_then_throw" }
  | { kind: "throw_without_post" }
  | { kind: "success_without_id" }
  | { kind: "fail"; code: Extract<Outcome, { kind: "failed" }>["code"]; retryable: boolean; retryAfterSeconds?: number };

type StoredPost = { id: string; clientRef: string; fingerprint: string; state: "published" | "processing"; checksLeft: number; destination: string };

export class MockAdapter implements PlatformAdapter {
  script: MockStep[] = [];
  posts: StoredPost[] = [];
  createCalls: { destination: string; clientRef: string; caption: string }[] = [];
  lookupCalls: string[] = [];
  supportsClientRef = true;
  lookupsDefinitive = true;
  private sequence = 0;

  enqueue(...steps: MockStep[]) {
    this.script.push(...steps);
    return this;
  }

  getCapabilities(): CapabilityManifest {
    return {
      platform: "mock",
      features: { text: "VERIFIED_LIVE", single_image: "UNSUPPORTED", video: "VERIFIED_LIVE", native_schedule: "UNSUPPORTED", delete: "UNSUPPORTED", find_by_client_ref: "VERIFIED_LIVE" },
      maxTextLength: 280,
      videoLimits: { maxBytes: 100_000_000, maxSeconds: 180, aspectRatios: ["9:16", "16:9", "1:1"] },
      requiredFields: ["caption"],
    };
  }

  requiredScopes() {
    return ["mock.write"];
  }

  validateContent(variant: VariantSnapshot) {
    const errors: string[] = [];
    if (!variant.caption.trim()) errors.push("A caption is required.");
    if (variant.caption.length > 280) errors.push("The caption is longer than 280 characters.");
    if (variant.mediaStorageKey.endsWith(".invalid")) errors.push("The media file type is not supported.");
    return errors.length ? { ok: false as const, errors } : { ok: true as const };
  }

  async healthCheck() {
    return { state: "GREEN" as const, detail: "mock" };
  }

  async getRateBudget() {
    return null;
  }

  async beginMediaUpload(_destination: DestinationRef, mediaStorageKey: string) {
    return { sessionId: `upload-${++this.sequence}`, mediaRef: mediaStorageKey, nextIndex: 0, complete: false };
  }

  async uploadMediaChunk(session: { sessionId: string; mediaRef: string; nextIndex: number; complete: boolean }, _chunk: ArrayBuffer, index: number) {
    return { ...session, nextIndex: index + 1, complete: true };
  }

  async getMediaProcessingStatus() {
    return { state: "ready" as const, detail: "mock" };
  }

  async cancelMediaUpload() {}

  async createPost(destination: DestinationRef, variant: VariantSnapshot, clientRef: string): Promise<Outcome> {
    this.createCalls.push({ destination: destination.id, clientRef, caption: variant.caption });
    const step = this.script.shift() ?? { kind: "publish" as const };
    const store = (state: StoredPost["state"], checksLeft = 0) => {
      const post = { id: `mock-post-${++this.sequence}`, clientRef, fingerprint: variant.revisionHash, state, checksLeft, destination: destination.id };
      this.posts.push(post);
      return post;
    };
    if (step.kind === "publish") {
      const post = store("published");
      return { kind: "published", platformPostId: post.id, platformUrl: `https://mock.example/p/${post.id}` };
    }
    if (step.kind === "processing") {
      const post = store("processing", step.readyAfterChecks ?? 1);
      return { kind: "processing", platformPostId: post.id };
    }
    if (step.kind === "accept_then_throw") {
      store("published");
      throw new Error("Connection reset after the platform accepted the post.");
    }
    if (step.kind === "throw_without_post") throw new Error("Connection reset before the platform answered.");
    if (step.kind === "success_without_id") return { kind: "published", platformPostId: "", platformUrl: "" };
    return { kind: "failed", code: step.code, message: `Mock failure: ${step.code}`, retryable: step.retryable, retryAfterSeconds: step.retryAfterSeconds };
  }

  async readbackPost(_destination: DestinationRef, platformPostId: string): Promise<LookupResult> {
    this.lookupCalls.push(`readback:${platformPostId}`);
    return this.describe(this.posts.find((post) => post.id === platformPostId));
  }

  async findByClientRef(_destination: DestinationRef, clientRef: string): Promise<LookupResult> {
    this.lookupCalls.push(`clientRef:${clientRef}`);
    if (!this.supportsClientRef) return { kind: "unsupported" };
    return this.describe(this.posts.find((post) => post.clientRef === clientRef));
  }

  async findRecentCandidates(destination: DestinationRef, variant: VariantSnapshot): Promise<LookupResult> {
    this.lookupCalls.push(`candidates:${variant.revisionHash}`);
    return this.describe(this.posts.find((post) => post.fingerprint === variant.revisionHash && post.destination === destination.id));
  }

  private describe(post: StoredPost | undefined): LookupResult {
    if (!post) return { kind: "not_found", definitive: this.lookupsDefinitive };
    if (post.state === "processing") {
      if (post.checksLeft > 0) {
        post.checksLeft -= 1;
        return { kind: "processing", platformPostId: post.id };
      }
      post.state = "published";
    }
    return { kind: "published", platformPostId: post.id, platformUrl: `https://mock.example/p/${post.id}` };
  }
}
