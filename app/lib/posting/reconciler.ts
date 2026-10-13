import type { LookupResult } from "./adapter.ts";
import type { PostingDeps, SlotRow } from "./engine.ts";
import { audit, destinationRef, getDestination, getVariant, iso, latestAttempt, moveSlot } from "./engine.ts";
import { closeAttempt } from "./dispatcher.ts";

export type ReconcileSummary = { expiredLeases: number; published: number; processing: number; retryReady: number; failed: number; stillUncertain: number; resumed: number };

// A worker that died mid-send leaves an expired lease. We do not know whether the
// platform created the post, so the slot goes to UNCERTAIN. It never goes back to QUEUED.
export async function expireLeases(deps: PostingDeps) {
  const now = iso(deps.now());
  const rows = await deps.db.prepare("SELECT id, attempt_id FROM post_slots WHERE slot_status = 'IN_FLIGHT' AND lease_expires_at < ?").bind(now).all<{ id: string; attempt_id: string }>();
  let expired = 0;
  for (const row of rows.results) {
    const moved = await moveSlot(deps, row.id, ["IN_FLIGHT"], "UNCERTAIN", { attemptId: row.attempt_id, uncertainSince: now });
    if (!moved) continue;
    expired += 1;
    await deps.db.prepare("UPDATE delivery_attempts SET outcome = 'uncertain', error_message = 'The worker lease expired before a result was recorded.', finished_at = ? WHERE id = ? AND outcome = 'in_flight'")
      .bind(now, row.attempt_id).run();
    await audit(deps, { slotId: row.id, actorType: "engine", action: "lease_expired_uncertain" });
  }
  return expired;
}

export async function reconcile(deps: PostingDeps): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { expiredLeases: await expireLeases(deps), published: 0, processing: 0, retryReady: 0, failed: 0, stillUncertain: 0, resumed: 0 };
  const now = iso(deps.now());

  const waiting = await deps.db.prepare("SELECT * FROM post_slots WHERE slot_status IN ('PROCESSING','UNCERTAIN') ORDER BY scheduled_at_utc ASC, id ASC LIMIT ?")
    .bind(deps.batchSize).all<SlotRow>();
  for (const slot of waiting.results) {
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
      summary.stillUncertain += 1;
    }
  }

  const cooled = await deps.db.prepare("UPDATE post_slots SET slot_status = 'RETRY_READY', updated_at = ? WHERE slot_status = 'RATE_LIMITED' AND next_retry_at <= ?").bind(now, now).run();
  const reauthorized = await deps.db.prepare(`UPDATE post_slots SET slot_status = 'RETRY_READY', next_retry_at = NULL, updated_at = ?
    WHERE slot_status = 'AUTH_REQUIRED' AND destination_id IN (
      SELECT d.id FROM social_destinations d JOIN social_connections c ON c.id = d.connection_id WHERE c.health_state = 'GREEN' AND c.status = 'active')`).bind(now).run();
  summary.resumed = cooled.meta.changes + reauthorized.meta.changes;
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
    const byContent = await adapter.findRecentCandidates(ref, slot.approved_revision_hash, attempt.started_at);
    return byContent.kind === "unsupported" ? { kind: "not_found", definitive: false } : byContent;
  } catch {
    return { kind: "not_found", definitive: false };
  } finally {
    await deps.db.prepare("UPDATE delivery_attempts SET last_checked_at = ? WHERE id = ?").bind(iso(deps.now()), attempt.id).run();
  }
}
