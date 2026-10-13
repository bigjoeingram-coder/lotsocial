// Slot states and the only transitions the engine may make.
// Spec: docs/posting-engine/CHECKPOINT-1.md section 5.
export const SLOT_STATES = [
  "DRAFT", "READY_FOR_REVIEW", "APPROVED", "QUEUED", "IN_FLIGHT", "PROCESSING",
  "PUBLISHED", "UNCERTAIN", "RATE_LIMITED", "AUTH_REQUIRED", "FAILED",
  "RETRY_READY", "CANCELED", "SUPERSEDED",
] as const;

export type SlotState = (typeof SLOT_STATES)[number];

const PRE_SEND: SlotState[] = ["DRAFT", "READY_FOR_REVIEW", "APPROVED", "QUEUED", "RETRY_READY", "RATE_LIMITED", "AUTH_REQUIRED"];

export const ALLOWED_TRANSITIONS: Record<SlotState, SlotState[]> = {
  DRAFT: ["READY_FOR_REVIEW", "APPROVED", "QUEUED", "CANCELED", "SUPERSEDED"],
  READY_FOR_REVIEW: ["DRAFT", "APPROVED", "CANCELED", "SUPERSEDED"],
  APPROVED: ["QUEUED", "DRAFT", "CANCELED", "SUPERSEDED"],
  QUEUED: ["IN_FLIGHT", "DRAFT", "CANCELED", "SUPERSEDED"],
  // An expired or unknown send goes to UNCERTAIN. IN_FLIGHT never returns to QUEUED.
  IN_FLIGHT: ["PUBLISHED", "PROCESSING", "UNCERTAIN", "RATE_LIMITED", "AUTH_REQUIRED", "FAILED", "RETRY_READY", "DRAFT"],
  PROCESSING: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  UNCERTAIN: ["PUBLISHED", "PROCESSING", "RETRY_READY", "FAILED"],
  RATE_LIMITED: ["RETRY_READY", "CANCELED", "SUPERSEDED", "DRAFT"],
  AUTH_REQUIRED: ["RETRY_READY", "CANCELED", "SUPERSEDED", "DRAFT"],
  FAILED: [],
  RETRY_READY: ["IN_FLIGHT", "CANCELED", "SUPERSEDED", "DRAFT"],
  CANCELED: [],
  SUPERSEDED: [],
};

export function canTransition(from: SlotState, to: SlotState) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isPreSend(state: SlotState) {
  return PRE_SEND.includes(state);
}

export const HEALTH_STATES = ["GREEN", "DEGRADED", "AUTH_REQUIRED", "RATE_LIMITED", "PLATFORM_OUTAGE", "UNVERIFIED", "DISABLED"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];
