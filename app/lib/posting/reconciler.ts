import type { LookupResult } from "./adapter.ts";
import type { PostingDeps, SlotRow } from "./engine.ts";
import type { VariantSnapshot } from "./adapter.ts";
import { addSeconds, attemptWithPost, audit, destinationRef, getDestination, getVariant, iso, latestAttempt, moveSlot } from "./engine.ts";
import { closeAttempt } from "./dispatcher.ts";

export type ReconcileSummary = { expiredLeases: number; neverSentRequeued: number; needsReview: number; published: number; processing: number; retryReady: number; failed: number; stillUncertain: number; resumed: number };

// A worker that died leaves an expired lease. What happens next depends on the send marker:
// - no marker: the platform call never started, so nothing was posted. The slot is safe to retry.
// - marker set: the platform may have the post. The slot goes to UNCERTAIN and is never blindly re-sent.
// Neither path returns the slot to QUEUED.
// Each move is one conditional UPDATE that re-checks the marker and the lease, so a worker writing
// the marker at the same moment cannot be classed as "never sent".
export async function expireLeases(deps: PostingDeps) {
  const now = iso(deps.now());
  const neverSent = await deps.db.prepare(`UPDATE post_slots
      SET slot_status = CASE WHEN attempt_count >= ? THEN 'FAILED' ELSE 'RETRY_READY' END, next_retry_at = NULL, uncertain_since = NULL, updated_at = ?
    WHERE slot_status = 'IN_FLIGHT' AND lease_expires_at < ? AND send_started_at IS NULL
    RETURNING id, attempt_id, slot_status`).bind(deps.maxAttempts, now, now).all<{ id: string; attempt_id: string; slot_status: string }>();
  for (const row of neverSent.results) {
    await deps.db.prepare("UPDATE delivery_attempts SET outcome = 'abandoned', error_message = 'The worker stopped before the send started.', finished_at = ? WHERE id = ? AND outcome = 'in_flight'")
      .bind(now, row.attempt_id).run();
    await audit(deps, { slotId: row.id, actorType: "engine", action: "lease_expired_never_sent", metadata: { next: row.slot_status } });
  }
  const uncertain = await deps.db.prepare(`UPDATE post_slots
      SET slot_status = 'UNCERTAIN', next_retry_at = NULL, uncertain_since = ?, updated_at = ?
    WHERE slot_status = 'IN_FLIGHT' AND lease_expires_at < ? AND send_started_at IS NOT NULL
    RETURNING id, attempt_id`).bind(now, now, now).all<{ id: string; attempt_id: string }>();
  for (const row of uncertain.results) {
    await deps.db.prepare("UPDATE delivery_attempts SET outcome = 'uncertain', error_message = 'The worker lease expired before a result was recorded.', finished_at = ? WHERE id = ? AND outcome = 'in_flight'")
      .bind(now, row.attempt_id).run();
    await audit(deps, { slotId: row.id, actorType: "engine", action: "lease_expired_uncertain" });
  }
  return { uncertain: uncertain.results.length, neverSent: neverSent.results.length };
}

export async function reconcile(deps: PostingDeps): Promise<ReconcileSummary> {
  const expired = await expireLeases(deps);
  const summary: ReconcileSummary = { expiredLeases: expired.uncertain, neverSentRequeued: expired.neverSent, needsReview: 0, published: 0, processing: 0, retryReady: 0, failed: 0, stillUncertain: 0, resumed: 0 };
  const now = iso(deps.now());

  const waiting = await deps.db.prepare("SELECT * FROM post_slots WHERE slot_status IN ('PROCESSING','UNCERTAIN') ORDER BY COALESCE(last_reconciled_at, '') ASC, scheduled_at_utc ASC, id ASC LIMIT ?")
    .bind(deps.batchSize).all<SlotRow>();
  // Least-recently-checked first, so slots that stay stuck cannot crowd out ones that can resolve.
  for (const slot of waiting.results) {
    await deps.db.prepare("UPDATE post_slots SET last_reconciled_at = ? WHERE id = ?").bind(now, slot.id).run();
    const result = await lookup(deps, slot);
    const attempt = await attemptWithPost(deps, slot.id) ?? await latestAttempt(deps, slot.id);
    // Every move is tied to the attempt this answer is about. If a newer attempt started while
    // the lookup was running, the answer is stale and changes nothing.
    const guard = { attemptId: slot.attempt_id };
    if (result.kind === "published") {
      if (attempt) await closeAttempt(deps, attempt.id, result, "published");
      if (await moveSlot(deps, slot.id, [slot.slot_status], "PUBLISHED", guard)) {
        summary.published += 1;
        await audit(deps, { slotId: slot.id, variantId: slot.variant_id, actorType: "engine", action: "published_by_reconcile", metadata: { platformPostId: result.platformPostId, platformUrl: result.platformUrl } });
      }
    } else if (result.kind === "processing") {
      if (attempt) await closeAttempt(deps, attempt.id, result, "processing");
      if (slot.slot_status === "UNCERTAIN" && await moveSlot(deps, slot.id, ["UNCERTAIN"], "PROCESSING", { ...guard, uncertainSince: now })) summary.processing += 1;
      else if (slot.slot_status === "PROCESSING" && await timedOut(deps, slot, guard)) summary.needsReview += 1;
    } else if (result.kind === "failed") {
      if (attempt) await closeAttempt(deps, attempt.id, { kind: "failed", code: result.code, message: result.message, retryable: false }, "failed");
      if (await moveSlot(deps, slot.id, [slot.slot_status], "FAILED", guard)) summary.failed += 1;
    } else if (result.kind === "not_found" && result.definitive && slot.slot_status === "UNCERTAIN" && pastSendGrace(deps, slot)) {
      // The platform confirmed no post exists, and no worker can still be sending, so a retry cannot duplicate.
      const next = slot.attempt_count >= deps.maxAttempts ? "FAILED" : "RETRY_READY";
      if (await moveSlot(deps, slot.id, ["UNCERTAIN"], next, guard)) {
        if (next === "FAILED") summary.failed += 1; else summary.retryReady += 1;
        await audit(deps, { slotId: slot.id, variantId: slot.variant_id, actorType: "engine", action: "reconcile_confirmed_no_post", metadata: { next } });
      }
    } else if (await timedOut(deps, slot, guard)) {
      summary.needsReview += 1;
    } else if (slot.slot_status === "UNCERTAIN") {
      summary.stillUncertain += 1;
    }
  }

  // Resume one slot at a time so each resume is a checked transition with an audit record.
  const cooled = await deps.db.prepare("SELECT id, variant_id FROM post_slots WHERE slot_status = 'RATE_LIMITED' AND next_retry_at <= ? ORDER BY next_retry_at ASC LIMIT ?")
    .bind(now, deps.batchSize).all<{ id: string; variant_id: string }>();
  for (const row of cooled.results) {
    if (!await moveSlot(deps, row.id, ["RATE_LIMITED"], "RETRY_READY")) continue;
    summary.resumed += 1;
    await audit(deps, { slotId: row.id, variantId: row.variant_id, actorType: "engine", action: "resumed_after_rate_limit" });
  }
  // The resume test is the exact opposite of the dispatcher's hold test, so a held slot can always get out.
  const reauthorized = await deps.db.prepare(`SELECT s.id, s.variant_id FROM post_slots s
      JOIN social_destinations d ON d.id = s.destination_id JOIN social_connections c ON c.id = d.connection_id
    WHERE s.slot_status = 'AUTH_REQUIRED' AND c.health_state NOT IN ('AUTH_REQUIRED','DISABLED') AND c.status = 'active' AND d.status = 'active'
    ORDER BY s.scheduled_at_utc ASC LIMIT ?`).bind(deps.batchSize).all<{ id: string; variant_id: string }>();
  for (const row of reauthorized.results) {
    if (!await moveSlot(deps, row.id, ["AUTH_REQUIRED"], "RETRY_READY")) continue;
    summary.resumed += 1;
    await audit(deps, { slotId: row.id, variantId: row.variant_id, actorType: "engine", action: "resumed_after_reconnect" });
  }
  return summary;
}

// A worker may still be inside the platform call for a while after its lease expires.
// Until that window closes, "no such post" only means "not yet".
function pastSendGrace(deps: PostingDeps, slot: SlotRow) {
  const lease = Date.parse(slot.lease_expires_at ?? "");
  return !Number.isFinite(lease) || deps.now().getTime() >= addSeconds(new Date(lease), deps.sendGraceSeconds).getTime();
}

// Past the time limit a person decides. The engine stops checking and never re-sends.
async function timedOut(deps: PostingDeps, slot: SlotRow, guard: { attemptId: string }) {
  const since = Date.parse(slot.uncertain_since ?? "");
  if (!Number.isFinite(since) || deps.now().getTime() - since < deps.uncertainTimeoutSeconds * 1000) return false;
  if (!await moveSlot(deps, slot.id, [slot.slot_status], "NEEDS_REVIEW", guard)) return false;
  await audit(deps, { slotId: slot.id, variantId: slot.variant_id, actorType: "engine", action: slot.slot_status === "PROCESSING" ? "processing_timeout_needs_review" : "uncertain_timeout_needs_review", metadata: { since: slot.uncertain_since } });
  return true;
}

// Order matters: a known post id first, then our client reference, then a content match.
async function lookup(deps: PostingDeps, slot: SlotRow): Promise<LookupResult> {
  const destination = await getDestination(deps, slot.destination_id);
  const variant = await getVariant(deps, slot.variant_id);
  const adapter = variant ? deps.adapters[variant.platform] : undefined;
  // Prefer the attempt that holds a platform post id, even if a later attempt exists.
  const attempt = await attemptWithPost(deps, slot.id) ?? await latestAttempt(deps, slot.id);
  if (!destination || !variant || !adapter || !attempt) return { kind: "not_found", definitive: false };
  const ref = destinationRef(destination);
  try {
    if (attempt.platform_post_id) return await adapter.readbackPost(ref, attempt.platform_post_id);
    const byRef = await adapter.findByClientRef(ref, slot.idempotency_key);
    if (byRef.kind !== "unsupported" && !(byRef.kind === "not_found" && !byRef.definitive)) return byRef;
    // The match runs against the content as it was sent, never against the variant as it is now:
    // an edit after a lost answer must not hide the post that went out.
    const sent = sentContent(attempt.request_snapshot);
    if (!sent) return { kind: "not_found", definitive: false };
    const byContent = await adapter.findRecentCandidates(ref, sent, attempt.started_at);
    if (byContent.kind === "unsupported") return { kind: "not_found", definitive: false };
    // A content match is weaker than an id or a client reference: two slots can carry identical
    // content. Never let this slot claim a platform post that another slot already owns.
    if ((byContent.kind === "published" || byContent.kind === "processing") && await ownedByAnotherSlot(deps, slot.id, byContent.platformPostId)) {
      return { kind: "not_found", definitive: false };
    }
    return byContent;
  } catch {
    return { kind: "not_found", definitive: false };
  } finally {
    await deps.db.prepare("UPDATE delivery_attempts SET last_checked_at = ? WHERE id = ?").bind(iso(deps.now()), attempt.id).run();
  }
}

function sentContent(raw: string): VariantSnapshot | null {
  try {
    const parsed = JSON.parse(raw || "{}") as { sent?: VariantSnapshot };
    return parsed.sent && typeof parsed.sent.caption === "string" ? parsed.sent : null;
  } catch {
    return null;
  }
}

async function ownedByAnotherSlot(deps: PostingDeps, slotId: string, platformPostId: string) {
  const row = await deps.db.prepare("SELECT slot_id FROM delivery_attempts WHERE platform_post_id = ? AND slot_id <> ? LIMIT 1").bind(platformPostId, slotId).first<{ slot_id: string }>();
  return Boolean(row);
}
