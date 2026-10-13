import type { D1DatabaseLike } from "../schema-bootstrap.ts";
import type { AdapterRegistry, DestinationRef, VariantSnapshot } from "./adapter.ts";
import { revisionHash } from "./revision.ts";

// Everything the engine needs from the outside. Tests inject a clock, ids and adapters.
export type PostingDeps = {
  db: D1DatabaseLike;
  adapters: AdapterRegistry;
  now: () => Date;
  newId: () => string;
  workerId: string;
  leaseSeconds: number;
  maxAttempts: number;
  retryBaseSeconds: number;
  retryCapSeconds: number;
  batchSize: number;
  uncertainTimeoutSeconds: number;
  // How long after a lease expires a worker might still be mid-send. A "no such post" answer is not trusted before then.
  sendGraceSeconds: number;
};

export function defaultDeps(db: D1DatabaseLike, adapters: AdapterRegistry, overrides: Partial<PostingDeps> = {}): PostingDeps {
  return {
    db,
    adapters,
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    workerId: `worker-${crypto.randomUUID()}`,
    leaseSeconds: 300,
    maxAttempts: 4,
    retryBaseSeconds: 60,
    retryCapSeconds: 3600,
    batchSize: 25,
    uncertainTimeoutSeconds: 6 * 3600,
    sendGraceSeconds: 900,
    ...overrides,
  };
}

export type VariantRow = {
  id: string; creative_project_id: string; destination_id: string; platform: string;
  caption: string; title: string; description: string; platform_options: string;
  render_job_id: string; media_storage_key: string; media_checksum: string; revision: number; revision_hash: string;
  approval_status: string; approved_revision_hash: string; approved_by: string; approved_at: string | null;
  validation_status: string; validation_errors: string; supersedes_id: string | null;
};

export type SlotRow = {
  id: string; variant_id: string; destination_id: string; scheduled_at_utc: string; timezone: string;
  slot_status: string; idempotency_key: string; approved_revision_hash: string; worker_id: string;
  attempt_id: string; claimed_at: string | null; lease_expires_at: string | null; attempt_count: number;
  next_retry_at: string | null; uncertain_since: string | null; send_started_at: string | null; last_reconciled_at: string | null;
};

export type AttemptRow = {
  id: string; slot_id: string; idempotency_key: string; adapter: string; request_snapshot: string; outcome: string;
  platform_post_id: string; platform_url: string; error_code: string; error_message: string;
  started_at: string; finished_at: string | null;
};

type DestinationJoin = {
  id: string; connection_id: string; platform: string; platform_ref: string; kind: string; status: string;
  credentials_ref: string; health_state: string; connection_status: string;
};

export function iso(date: Date) {
  return date.toISOString();
}

export function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

export async function audit(deps: PostingDeps, input: { slotId?: string; variantId?: string; actorType: string; actorEmail?: string; action: string; metadata?: Record<string, unknown> }) {
  await deps.db.prepare(`INSERT INTO posting_audit_events (slot_id, variant_id, actor_type, actor_email, action, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.slotId ?? "", input.variantId ?? "", input.actorType, input.actorEmail ?? "", input.action, JSON.stringify(input.metadata ?? {}), iso(deps.now()))
    .run();
}

export async function getVariant(deps: PostingDeps, id: string) {
  return deps.db.prepare("SELECT * FROM post_variants WHERE id = ?").bind(id).first<VariantRow>();
}

export async function getSlot(deps: PostingDeps, id: string) {
  return deps.db.prepare("SELECT * FROM post_slots WHERE id = ?").bind(id).first<SlotRow>();
}

export async function latestAttempt(deps: PostingDeps, slotId: string) {
  return deps.db.prepare("SELECT * FROM delivery_attempts WHERE slot_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1").bind(slotId).first<AttemptRow>();
}

// The attempt that holds a platform post id, if any attempt of this slot ever got one.
// `liveOnly` leaves out attempts whose post the platform reported as failed or rejected.
export async function attemptWithPost(deps: PostingDeps, slotId: string, liveOnly = false) {
  return deps.db.prepare(`SELECT * FROM delivery_attempts WHERE slot_id = ? AND platform_post_id <> ''${liveOnly ? " AND outcome <> 'failed'" : ""} ORDER BY started_at DESC, rowid DESC LIMIT 1`).bind(slotId).first<AttemptRow>();
}

export async function getDestination(deps: PostingDeps, id: string) {
  return deps.db.prepare(`SELECT d.id, d.connection_id, d.platform, d.platform_ref, d.kind, d.status,
      c.credentials_ref, c.health_state, c.status AS connection_status
    FROM social_destinations d JOIN social_connections c ON c.id = d.connection_id WHERE d.id = ?`)
    .bind(id).first<DestinationJoin>();
}

export function destinationRef(row: DestinationJoin): DestinationRef {
  return { id: row.id, platform: row.platform, platformRef: row.platform_ref, kind: row.kind, connectionId: row.connection_id, credentialsRef: row.credentials_ref };
}

export function snapshot(variant: VariantRow): VariantSnapshot {
  let options: Record<string, unknown> = {};
  try { options = JSON.parse(variant.platform_options || "{}"); } catch { options = {}; }
  return {
    variantId: variant.id, platform: variant.platform, caption: variant.caption, title: variant.title,
    description: variant.description, platformOptions: options, mediaStorageKey: variant.media_storage_key,
    revisionHash: variant.revision_hash,
  };
}

export function currentHash(variant: VariantRow) {
  return revisionHash({
    platform: variant.platform, destinationId: variant.destination_id, caption: variant.caption, title: variant.title,
    description: variant.description, platformOptions: variant.platform_options, mediaStorageKey: variant.media_storage_key, mediaChecksum: variant.media_checksum,
  });
}

// Moves a slot only if it is still in the expected state (and attempt, when given).
// Returns false when another worker or an edit got there first.
export async function moveSlot(deps: PostingDeps, slotId: string, from: string[], to: string, extra: { attemptId?: string; nextRetryAt?: string | null; uncertainSince?: string | null } = {}) {
  const placeholders = from.map(() => "?").join(", ");
  const attemptClause = extra.attemptId ? " AND attempt_id = ?" : "";
  const values: unknown[] = [to, extra.nextRetryAt ?? null, extra.uncertainSince ?? null, iso(deps.now()), slotId, ...from];
  if (extra.attemptId) values.push(extra.attemptId);
  const result = await deps.db.prepare(`UPDATE post_slots
      SET slot_status = ?, next_retry_at = ?, uncertain_since = ?, updated_at = ?
    WHERE id = ? AND slot_status IN (${placeholders})${attemptClause}`).bind(...values).run();
  return result.meta.changes > 0;
}

export function backoffSeconds(deps: PostingDeps, attemptCount: number, retryAfterSeconds?: number) {
  const exponential = deps.retryBaseSeconds * 2 ** Math.max(0, attemptCount - 1);
  return Math.min(deps.retryCapSeconds, Math.max(exponential, retryAfterSeconds ?? 0));
}
