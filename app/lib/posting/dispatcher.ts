import type { Outcome } from "./adapter.ts";
import type { PostingDeps, SlotRow } from "./engine.ts";
import { addSeconds, audit, backoffSeconds, currentHash, destinationRef, getDestination, getVariant, iso, moveSlot, snapshot } from "./engine.ts";

type Claimed = Pick<SlotRow, "id" | "variant_id" | "destination_id" | "approved_revision_hash" | "idempotency_key" | "attempt_count">;

// Atomic claim: one conditional UPDATE. Two workers cannot both get the row.
export async function claimSlot(deps: PostingDeps, slotId: string): Promise<(Claimed & { attemptId: string }) | null> {
  const now = deps.now();
  const attemptId = deps.newId();
  const row = await deps.db.prepare(`UPDATE post_slots
      SET slot_status = 'IN_FLIGHT', worker_id = ?, attempt_id = ?, claimed_at = ?, lease_expires_at = ?,
          send_started_at = NULL, attempt_count = attempt_count + 1, updated_at = ?
    WHERE id = ? AND slot_status IN ('QUEUED','RETRY_READY') AND scheduled_at_utc <= ?
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
    RETURNING id, variant_id, destination_id, approved_revision_hash, idempotency_key, attempt_count`)
    .bind(deps.workerId, attemptId, iso(now), iso(addSeconds(now, deps.leaseSeconds)), iso(now), slotId, iso(now), iso(now))
    .first<Claimed>();
  return row ? { ...row, attemptId } : null;
}

export async function dueSlotIds(deps: PostingDeps) {
  const now = iso(deps.now());
  const rows = await deps.db.prepare(`SELECT id FROM post_slots
    WHERE slot_status IN ('QUEUED','RETRY_READY') AND scheduled_at_utc <= ? AND (next_retry_at IS NULL OR next_retry_at <= ?)
    ORDER BY scheduled_at_utc ASC, id ASC LIMIT ?`).bind(now, now, deps.batchSize).all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

export type DispatchResult = { slotId: string; status: string; sent: boolean };

export async function dispatchSlot(deps: PostingDeps, slotId: string): Promise<DispatchResult | null> {
  const claim = await claimSlot(deps, slotId);
  if (!claim) return null;
  const attemptId = claim.attemptId;
  const finish = async (status: string, sent: boolean, extra: Parameters<typeof moveSlot>[4] = {}) => {
    await moveSlot(deps, slotId, ["IN_FLIGHT"], status, { ...extra, attemptId });
    return { slotId, status, sent };
  };

  const variant = await getVariant(deps, claim.variant_id);
  const destination = await getDestination(deps, claim.destination_id);
  const adapter = variant ? deps.adapters[variant.platform] : undefined;

  // Send-time approval check. The hash is recomputed from the stored fields,
  // so an edit that slipped past approval can never be sent.
  const liveHash = variant ? await currentHash(variant) : "";
  if (!variant || variant.approval_status !== "APPROVED" || liveHash !== claim.approved_revision_hash || variant.approved_revision_hash !== claim.approved_revision_hash) {
    await audit(deps, { slotId, variantId: claim.variant_id, actorType: "engine", action: "send_blocked_approval_mismatch", metadata: { approved: claim.approved_revision_hash, live: liveHash } });
    return finish("DRAFT", false);
  }
  if (!variant.media_storage_key) {
    await audit(deps, { slotId, variantId: variant.id, actorType: "engine", action: "send_blocked_no_asset" });
    return finish("FAILED", false);
  }
  if (!adapter || !destination) {
    await audit(deps, { slotId, variantId: variant.id, actorType: "engine", action: "send_blocked_destination_missing" });
    return finish("FAILED", false);
  }
  // A paused or unauthorized connection is recoverable, so the slot waits instead of failing.
  if (destination.status !== "active" || destination.connection_status !== "active" || destination.health_state === "DISABLED" || destination.health_state === "AUTH_REQUIRED") {
    await audit(deps, { slotId, variantId: variant.id, actorType: "engine", action: "send_held_connection_unavailable", metadata: { health: destination.health_state, destination: destination.status, connection: destination.connection_status } });
    return finish("AUTH_REQUIRED", false);
  }
  const content = snapshot(variant);
  const validation = adapter.validateContent(content);
  if (!validation.ok) {
    await recordAttempt(deps, attemptId, slotId, claim.idempotency_key, variant.platform, content.revisionHash);
    await closeAttempt(deps, attemptId, { kind: "failed", code: "VALIDATION", message: validation.errors.join(" "), retryable: false }, "rejected_validation");
    await audit(deps, { slotId, variantId: variant.id, actorType: "engine", action: "send_blocked_validation", metadata: { errors: validation.errors } });
    return finish("FAILED", false);
  }

  await recordAttempt(deps, attemptId, slotId, claim.idempotency_key, variant.platform, content.revisionHash);
  await audit(deps, { slotId, variantId: variant.id, actorType: "engine", action: "send_started", metadata: { attemptId, revisionHash: content.revisionHash, approvedBy: variant.approved_by, approvedAt: variant.approved_at } });

  // The send marker is written immediately before the platform call. A slot whose lease
  // expires without it was provably never sent; one with it may have been.
  const marked = await deps.db.prepare("UPDATE post_slots SET send_started_at = ?, updated_at = ? WHERE id = ? AND slot_status = 'IN_FLIGHT' AND attempt_id = ?")
    .bind(iso(deps.now()), iso(deps.now()), slotId, attemptId).run();
  if (marked.meta.changes === 0) {
    // The lease was lost between the claim and here. Another pass owns the slot now, so send nothing.
    await closeAttempt(deps, attemptId, { kind: "failed", code: "INTERNAL", message: "The lease was lost before the send started.", retryable: false }, "abandoned");
    return { slotId, status: "LEASE_LOST", sent: false };
  }

  let outcome: Outcome;
  try {
    outcome = await adapter.createPost(destinationRef(destination), content, claim.idempotency_key);
  } catch (caught) {
    // A thrown error means we do not know whether the platform created the post.
    outcome = { kind: "uncertain", detail: caught instanceof Error ? caught.message : "The send failed with an unknown error." };
  }
  // A success with no post id is not a success we can prove.
  if ((outcome.kind === "published" || outcome.kind === "processing") && !outcome.platformPostId) {
    outcome = { kind: "uncertain", detail: "The platform reported success without a post id." };
  }

  const now = deps.now();
  if (outcome.kind === "published") {
    await closeAttempt(deps, attemptId, outcome, "published");
    await deps.db.prepare("UPDATE social_connections SET last_success_at = ?, health_state = 'GREEN', health_checked_at = ?, updated_at = ? WHERE id = ?")
      .bind(iso(now), iso(now), iso(now), destination.connection_id).run();
    await audit(deps, { slotId, variantId: variant.id, actorType: "engine", action: "published", metadata: { platformPostId: outcome.platformPostId, platformUrl: outcome.platformUrl, revisionHash: content.revisionHash } });
    return finish("PUBLISHED", true);
  }
  if (outcome.kind === "processing") {
    await closeAttempt(deps, attemptId, outcome, "processing");
    return finish("PROCESSING", true);
  }
  if (outcome.kind === "uncertain") {
    await closeAttempt(deps, attemptId, outcome, "uncertain");
    await audit(deps, { slotId, variantId: variant.id, actorType: "engine", action: "send_uncertain", metadata: { detail: outcome.detail } });
    return finish("UNCERTAIN", true, { uncertainSince: iso(now) });
  }

  if (outcome.code === "UNCERTAIN_WRITE") {
    await closeAttempt(deps, attemptId, outcome, "uncertain");
    return finish("UNCERTAIN", true, { uncertainSince: iso(now) });
  }
  if (outcome.code === "AUTH_REQUIRED" || outcome.code === "PERMISSION_DENIED") {
    await closeAttempt(deps, attemptId, outcome, "auth_required");
    await deps.db.prepare("UPDATE social_connections SET health_state = 'AUTH_REQUIRED', health_checked_at = ?, updated_at = ? WHERE id = ?")
      .bind(iso(now), iso(now), destination.connection_id).run();
    return finish("AUTH_REQUIRED", true);
  }
  const retryAt = iso(addSeconds(now, backoffSeconds(deps, claim.attempt_count, outcome.retryAfterSeconds)));
  if (outcome.code === "RATE_LIMITED") {
    await closeAttempt(deps, attemptId, outcome, "rate_limited");
    if (claim.attempt_count >= deps.maxAttempts) return finish("FAILED", true);
    return finish("RATE_LIMITED", true, { nextRetryAt: retryAt });
  }
  await closeAttempt(deps, attemptId, outcome, "failed");
  if (outcome.retryable && claim.attempt_count < deps.maxAttempts) return finish("RETRY_READY", true, { nextRetryAt: retryAt });
  await audit(deps, { slotId, variantId: variant.id, actorType: "engine", action: "send_failed", metadata: { code: outcome.code, message: outcome.message } });
  return finish("FAILED", true);
}

async function recordAttempt(deps: PostingDeps, attemptId: string, slotId: string, idempotencyKey: string, adapter: string, revisionHash: string) {
  // The snapshot holds identifiers only. Tokens and secrets never go in it.
  await deps.db.prepare(`INSERT INTO delivery_attempts (id, slot_id, idempotency_key, adapter, request_snapshot, outcome, started_at)
    VALUES (?, ?, ?, ?, ?, 'in_flight', ?)`)
    .bind(attemptId, slotId, idempotencyKey, adapter, JSON.stringify({ revisionHash }), iso(deps.now())).run();
}

export async function closeAttempt(deps: PostingDeps, attemptId: string, outcome: Outcome | { kind: "published" | "processing"; platformPostId: string; platformUrl?: string }, label: string) {
  const now = iso(deps.now());
  const postId = "platformPostId" in outcome ? outcome.platformPostId : "";
  const url = "platformUrl" in outcome ? outcome.platformUrl ?? "" : "";
  const requestId = "providerRequestId" in outcome ? outcome.providerRequestId ?? "" : "";
  const code = outcome.kind === "failed" ? outcome.code : "";
  const message = outcome.kind === "failed" ? outcome.message : outcome.kind === "uncertain" ? outcome.detail : "";
  const retryable = outcome.kind === "failed" && outcome.retryable ? 1 : 0;
  await deps.db.prepare(`UPDATE delivery_attempts SET outcome = ?, platform_post_id = CASE WHEN ? = '' THEN platform_post_id ELSE ? END,
      platform_url = CASE WHEN ? = '' THEN platform_url ELSE ? END, provider_request_id = ?, error_code = ?, error_message = ?,
      retryable = ?, finished_at = ?, last_checked_at = ? WHERE id = ?`)
    .bind(label, postId, postId, url, url, requestId, code, message, retryable, now, now, attemptId).run();
}
