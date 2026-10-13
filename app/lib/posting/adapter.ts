// The one contract every platform adapter implements.
// LotSocial owns this code. Adapters call official platform APIs with fetch;
// no third-party social-posting SDK, scheduler or adapter library is allowed.
export type ErrorCode =
  | "VALIDATION" | "AUTH_REQUIRED" | "PERMISSION_DENIED" | "RATE_LIMITED"
  | "MEDIA_PROCESSING" | "PLATFORM_REJECTED" | "TRANSIENT_PROVIDER"
  | "INTERNAL" | "UNCERTAIN_WRITE";

export type Verification = "VERIFIED_LIVE" | "DOCUMENTED_NOT_LIVE_TESTED" | "UNSUPPORTED";

export type Feature = "text" | "single_image" | "video" | "native_schedule" | "delete" | "find_by_client_ref";

export type CapabilityManifest = {
  platform: string;
  features: Record<Feature, Verification>;
  maxTextLength: number;
  videoLimits: { maxBytes: number; maxSeconds: number; aspectRatios: string[] };
  requiredFields: string[];
};

export type DestinationRef = {
  id: string;
  platform: string;
  platformRef: string;
  kind: string;
  connectionId: string;
  credentialsRef: string;
};

export type VariantSnapshot = {
  variantId: string;
  platform: string;
  caption: string;
  title: string;
  description: string;
  platformOptions: Record<string, unknown>;
  mediaStorageKey: string;
  revisionHash: string;
};

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type Outcome =
  // `warning` reports a post that exists but is not what was asked for (for example, kept private). The id is never dropped.
  | { kind: "published"; platformPostId: string; platformUrl: string; providerRequestId?: string; warning?: string }
  | { kind: "processing"; platformPostId: string; providerRequestId?: string; warning?: string }
  | { kind: "uncertain"; detail: string }
  | { kind: "failed"; code: ErrorCode; message: string; retryable: boolean; retryAfterSeconds?: number };

// A lookup either finds the post, or reports that it did not.
// `definitive: true` means the platform has confirmed no such post exists,
// so a retry cannot create a duplicate. Anything less stays uncertain.
export type LookupResult =
  | { kind: "published"; platformPostId: string; platformUrl: string }
  | { kind: "processing"; platformPostId: string }
  | { kind: "failed"; code: ErrorCode; message: string }
  | { kind: "not_found"; definitive: boolean }
  | { kind: "unsupported" };

export type HealthResult = { state: "GREEN" | "DEGRADED" | "AUTH_REQUIRED" | "RATE_LIMITED" | "PLATFORM_OUTAGE" | "UNVERIFIED"; detail: string };

export type RateBudget = { remaining: number; resetsAt: string };

export type UploadSession = { sessionId: string; mediaRef: string; nextIndex: number; complete: boolean };

export type MediaStatus = { state: "processing" | "ready" | "failed"; detail: string };

export interface PlatformAdapter {
  getCapabilities(): CapabilityManifest;
  requiredScopes(operation: string): string[];
  validateContent(variant: VariantSnapshot): ValidationResult;

  healthCheck(destination: DestinationRef): Promise<HealthResult>;
  getRateBudget(destination: DestinationRef): Promise<RateBudget | null>;

  beginMediaUpload(destination: DestinationRef, mediaStorageKey: string): Promise<UploadSession>;
  uploadMediaChunk(session: UploadSession, chunk: ArrayBuffer, index: number): Promise<UploadSession>;
  getMediaProcessingStatus(destination: DestinationRef, mediaRef: string): Promise<MediaStatus>;
  cancelMediaUpload(session: UploadSession): Promise<void>;

  createPost(destination: DestinationRef, variant: VariantSnapshot, clientRef: string): Promise<Outcome>;
  readbackPost(destination: DestinationRef, platformPostId: string): Promise<LookupResult>;
  findByClientRef(destination: DestinationRef, clientRef: string): Promise<LookupResult>;
  // Content match, for platforms with no client reference. It gets the variant so it can compare real fields.
  findRecentCandidates(destination: DestinationRef, variant: VariantSnapshot, sinceIso: string): Promise<LookupResult>;

  scheduleNativePost?(destination: DestinationRef, variant: VariantSnapshot, atIso: string): Promise<Outcome>;
  unscheduleNativePost?(destination: DestinationRef, platformPostId: string): Promise<void>;
  deletePost?(destination: DestinationRef, platformPostId: string): Promise<void>;
}

export type AdapterRegistry = Record<string, PlatformAdapter>;
