import type { LookupResult } from "./adapter.ts";
import type { PostingDeps, SlotRow } from "./engine.ts";
import { audit, destinationRef, getDestination, getVariant, iso, latestAttempt, moveSlot, snapshot } from "./engine.ts";
import { closeAttempt } from "./dispatcher.ts";

export type ReconcileSummary = { expiredLeases: number; neverSentRequeued: number; needsReview: number; published: number; processing: number; retryReady: number; failed: number; stillUncertain: number; resumed: number };

// A worker that died leaves an expired lease. What happens next depends on the send marker:
// - no marker: the platform call never started, so nothing was posted. The slot is safe to retry.
// - marker set: the platform may have the post. The slot goes to UNCERTAIN and is never blindly re-sent.
// Neither path returns the slot to QUEUED.
export async function expireLeases(deps: PostingDeps) {
  const now = iso(deps.now());
  const rows = await deps.db.prepare("SELECT id, attempt_id, send_started_at, attempt_count FROM post_slots WHERE slot_status = 'IN_FLIGHT' AND lease_expires_at < ?")
    .bind(now).all<{ id: string; attempt_id: string; send_started_at: string | null; attempt_count: number }>();
  let uncertain = 0;
  let neverSent = 0;
  for (const row of rows.results) {
    if (!row.send_started_at) {
      const next = row.attempt_count >= deps.maxAttempts ? "FAILED" : "RETRY_READY";
      if (!await moveSlot(deps, row.id, ["IN_FLIGHT"], next, { attemptId: row.attempt_id })) continue;
      neverSent += 1;
      await deps.db.prepare("UPDATE delivery_attempts SET outcome = 'abandoned', error_message = 'The worker stopped before the send started.', finished_at = ? WHERE id = ? AND outcome = 'in_flight'")
        .bind(now, row.attempt_id).run();
      await audit(deps, { slotId: row.id, actorType: "engine", action: "lease_expired_never_sent", metadata: { next } });
      continue;
    }
    if (!await moveSlot(deps, row.id, ["IN_FLIGHT"], "UNCERTAIN", { attemptId: row.attempt_id, uncertainSince: now })) continue;
    uncertain += 1;
    await deps.db.prepare("UPDATE delivery_attempts SET outcome = 'uncertain', error_message = 'The worker lease expired before a result was recorded.', finished_at = ? WHERE id = ? AND outcome = 'in_flight'")
      .bind(now, row.attempt_id).run();
    await audit(deps, { slotId: row.id, actorType: "engine", action: "lease_expired_uncertain" });
  }
  return { uncertain, neverSent };
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
    const attempt = await latestAttempt(deps, slot.id);
    if (result.kind === "published") {
      if (attempt) await closeAttempt(deps, attempt.id, result, "published");
      if (await moveSlot(deps, slot.id, [slot.slot_status], "PUBLISHED")) {
        summary.published += 1;
        await audit(deps, { slotId: slot.id, variantId: slot.variant_id, actorType: "engine", action: "published_by_reconcile", metadata: { platformPostId: result.platformPostId, platformUrl: result.platformUrl } });
      }
    } else if (result.kind === "processing") {
      if (attempt) await closeAttempt(deps, attempt.id, result, "processing");
      if (slot.slot_status === "UNCERTAIN" && await moveSlot(deps, slot.id, ["UNCERTAIN"], "PROCESSING")) summary.processing += 1;
    } else if (result.kind === "failed") {
      if (attempt) await closeAttempt(deps, attempt.id, { kind: "failed", code: result.code, message: result.message, retryable: false }, "failed");
      if (await moveSlot(deps, slot.id, [slot.slot_status], "FAILED")) summary.failed += 1;
    } else if (result.kind === "not_found" && result.definitive && slot.slot_status === "UNCERTAIN") {
      // The platform confirmed no post exists, so a retry cannot duplicate.
      const next = slot.attempt_count >= deps.maxAttempts ? "FAILED" : "RETRY_READY";
      if (await moveSlot(deps, slot.id, ["UNCERTAIN"], next)) {
        if (next === "FAILED") summary.failed += 1; else summary.retryReady += 1;
        await audit(deps, { slotId: slot.id, variantId: slot.variant_id, actorType: "engine", action: "reconcile_confirmed_no_post", metadata: { next } });
      }
    } else if (slot.slot_status === "UNCERTAIN") {
      // Past the time limit, a person decides. The engine stops checking and never re-sends.
      const since = Date.parse(slot.uncertain_since ?? "");
      if (Number.isFinite(since) && deps.now().getTime() - since >= deps.uncertainTimeoutSeconds * 1000 && await moveSlot(deps, slot.id, ["UNCERTAIN"], "NEEDS_REVIEW")) {
        summary.needsReview += 1;
        await audit(deps, { slotId: slot.id, variantId: slot.variant_id, actorType: "engine", action: "uncertain_timeout_needs_review", metadata: { uncertainSince: slot.uncertain_since } });
      } else {
        summary.stillUncertain += 1;
      }
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
  const reauthorized = await deps.db.prepare(`SELECT s.id, s.variant_id FROM post_slots s
      JOIN social_destinations d ON d.id = s.destination_id JOIN social_connections c ON c.id = d.connection_id
    WHERE s.slot_status = 'AUTH_REQUIRED' AND c.health_state = 'GREEN' AND c.status = 'active' AND d.status = 'active'
    ORDER BY s.scheduled_at_utc ASC LIMIT ?`).bind(deps.batchSize).all<{ id: string; variant_id: string }>();
  for (const row of reauthorized.results) {
    if (!await moveSlot(deps, row.id, ["AUTH_REQUIRED"], "RETRY_READY")) continue;
    summary.resumed += 1;
    await audit(deps, { slotId: row.id, variantId: row.variant_id, actorType: "engine", action: "resumed_after_reconnect" });
  }
  return summary;
}

// Order matters: a known post id first, then our client reference, then a content match.
async function lookup(deps: PostingDeps, slot: SlotRow): Promise<LookupResult> {
  const destination = await getDestination(deps, slot.destination_id);
  const variant = await getVariant(deps, slot.variant_id);
  const adapter = variant ? deps.adapters[variant.platform] : undefined;
  const attempt = await latestAttempt(deps, slot.id);
  if (!destination || !variant || !adapter || !attempt) return { kind: "not_found", definitive: false };
  const ref = destinationRef(destination);
  try {
    if (attempt.platform_post_id) return await adapter.readbackPost(ref, attempt.platform_post_id);
    const byRef = await adapter.findByClientRef(ref, slot.idempotency_key);
    if (byRef.kind !== "unsupported" && !(byRef.kind === "not_found" && !byRef.definitive)) return byRef;
    const byContent = await adapter.findRecentCandidates(ref, snapshot(variant), attempt.started_at);
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

async function ownedByAnotherSlot(deps: PostingDeps, slotId: string, platformPostId: string) {
  const row = await deps.db.prepare("SELECT slot_id FROM delivery_attempts WHERE platform_post_id = ? AND slot_id <> ? LIMIT 1").bind(platformPostId, slotId).first<{ slot_id: string }>();
  return Boolean(row);
}
