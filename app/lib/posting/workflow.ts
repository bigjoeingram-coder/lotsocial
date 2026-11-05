import type { PostingDeps, VariantRow } from "./engine.ts";
import { audit, currentHash, getDestination, getSlot, getVariant, iso, snapshot } from "./engine.ts";
import { revisionHash } from "./revision.ts";

export type NewVariant = {
  creativeProjectId: string; destinationId: string; platform: string; caption: string;
  title?: string; description?: string; platformOptions?: Record<string, unknown>;
  renderJobId?: string; mediaStorageKey?: string; mediaChecksum?: string; supersedesId?: string;
};

const EDITABLE = { caption: "caption", title: "title", description: "description", platformOptions: "platform_options", mediaStorageKey: "media_storage_key", mediaChecksum: "media_checksum", renderJobId: "render_job_id" } as const;

// Every action a person takes is recorded under a real address. A blank or malformed one is refused.
function requirePerson(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? "")) throw new Error("A named person is required for this action.");
}

const POST_SEND = "('IN_FLIGHT','UNCERTAIN','PROCESSING','NEEDS_REVIEW')";

export async function createVariant(deps: PostingDeps, input: NewVariant, actorEmail: string) {
  requirePerson(actorEmail);
  const id = deps.newId();
  const platformOptions = JSON.stringify(input.platformOptions ?? {});
  const hash = await revisionHash({
    platform: input.platform, destinationId: input.destinationId, caption: input.caption, title: input.title ?? "",
    description: input.description ?? "", platformOptions, mediaStorageKey: input.mediaStorageKey ?? "", mediaChecksum: input.mediaChecksum ?? "",
  });
  const now = iso(deps.now());
  await deps.db.prepare(`INSERT INTO post_variants (id, creative_project_id, destination_id, platform, caption, title, description,
      platform_options, render_job_id, media_storage_key, media_checksum, revision, revision_hash, supersedes_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
    .bind(id, input.creativeProjectId, input.destinationId, input.platform, input.caption, input.title ?? "", input.description ?? "",
      platformOptions, input.renderJobId ?? "", input.mediaStorageKey ?? "", input.mediaChecksum ?? "", hash, input.supersedesId ?? null, now, now).run();
  if (input.supersedesId) {
    await deps.db.prepare(`UPDATE post_slots SET slot_status = 'SUPERSEDED', updated_at = ?
      WHERE variant_id = ? AND slot_status IN ('DRAFT','READY_FOR_REVIEW','APPROVED','QUEUED','RETRY_READY','RATE_LIMITED','AUTH_REQUIRED')`)
      .bind(now, input.supersedesId).run();
    // The old variant can never send again, whatever state its slots are in: approval is the send-time gate.
    await deps.db.prepare("UPDATE post_variants SET approval_status = 'SUPERSEDED', approved_revision_hash = '', updated_at = ? WHERE id = ?")
      .bind(now, input.supersedesId).run();
    await audit(deps, { variantId: input.supersedesId, actorType: "person", actorEmail, action: "variant_superseded", metadata: { by: id } });
  }
  await audit(deps, { variantId: id, actorType: "person", actorEmail, action: "variant_created", metadata: { revisionHash: hash } });
  return id;
}

// Any edit to a publish-affecting field makes a new revision and voids approval.
// Slots that were waiting on the old approval go back to DRAFT and cannot send.
export async function editVariant(deps: PostingDeps, variantId: string, changes: Partial<Record<keyof typeof EDITABLE, unknown>>, actorEmail: string) {
  requirePerson(actorEmail);
  const variant = await requireVariant(deps, variantId);
  const next: VariantRow = { ...variant };
  for (const [key, column] of Object.entries(EDITABLE)) {
    if (!(key in changes)) continue;
    const value = changes[key as keyof typeof EDITABLE];
    (next as unknown as Record<string, unknown>)[column] = key === "platformOptions" ? JSON.stringify(value ?? {}) : String(value ?? "");
  }
  const hash = await currentHash(next);
  if (hash === variant.revision_hash && next.render_job_id === variant.render_job_id) return variant.revision_hash;
  const now = iso(deps.now());
  await deps.db.prepare(`UPDATE post_variants SET caption = ?, title = ?, description = ?, platform_options = ?, media_storage_key = ?,
      media_checksum = ?, render_job_id = ?, revision = revision + 1, revision_hash = ?, approval_status = 'DRAFT', approved_revision_hash = '',
      approved_by = '', approved_at = NULL, validation_status = 'unchecked', validation_errors = '[]', updated_at = ?
    WHERE id = ?`)
    .bind(next.caption, next.title, next.description, next.platform_options, next.media_storage_key, next.media_checksum, next.render_job_id, hash, now, variantId).run();
  await deps.db.prepare(`UPDATE post_slots SET slot_status = 'DRAFT', approved_revision_hash = '', updated_at = ?
    WHERE variant_id = ? AND slot_status IN ('READY_FOR_REVIEW','APPROVED','QUEUED','RETRY_READY','RATE_LIMITED','AUTH_REQUIRED')`)
    .bind(now, variantId).run();
  await audit(deps, { variantId, actorType: "person", actorEmail, action: "variant_edited_approval_void", metadata: { from: variant.revision_hash, to: hash } });
  return hash;
}

export async function approveVariant(deps: PostingDeps, variantId: string, approverEmail: string) {
  requirePerson(approverEmail);
  const variant = await requireVariant(deps, variantId);
  if (variant.approval_status === "SUPERSEDED") return { ok: false as const, errors: ["This variant was replaced by a newer one and cannot be approved."] };
  const adapter = deps.adapters[variant.platform];
  if (!adapter) throw new Error(`No adapter is registered for ${variant.platform}.`);
  if (!variant.media_storage_key) return reject(deps, variant, ["A rendered asset is required before approval."]);
  const validation = adapter.validateContent(snapshot(variant));
  if (!validation.ok) return reject(deps, variant, validation.errors);
  const hash = await currentHash(variant);
  const now = iso(deps.now());
  const approved = await deps.db.prepare(`UPDATE post_variants SET approval_status = 'APPROVED', approved_revision_hash = ?, approved_by = ?, approved_at = ?,
      validation_status = 'valid', validation_errors = '[]', updated_at = ? WHERE id = ? AND revision_hash = ? AND approval_status <> 'SUPERSEDED'`)
    .bind(hash, approverEmail, now, now, variantId, hash).run();
  // An edit landed between the read and the write. Nothing was approved, so say so.
  if (approved.meta.changes === 0) return { ok: false as const, errors: ["The variant changed while it was being approved. Review it again."] };
  await audit(deps, { variantId, actorType: "person", actorEmail: approverEmail, action: "variant_approved", metadata: { revisionHash: hash, revision: variant.revision } });
  return { ok: true as const, revisionHash: hash };
}

async function reject(deps: PostingDeps, variant: VariantRow, errors: string[]) {
  await deps.db.prepare("UPDATE post_variants SET validation_status = 'invalid', validation_errors = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(errors), iso(deps.now()), variant.id).run();
  return { ok: false as const, errors };
}

// Queues one post. Refuses unless the variant is approved at its current revision,
// has an asset, passed validation, and the destination is usable.
export async function queueSlot(deps: PostingDeps, input: { variantId: string; scheduledAtUtc: string; timezone?: string }, actorEmail: string) {
  requirePerson(actorEmail);
  const variant = await requireVariant(deps, input.variantId);
  const errors: string[] = [];
  if (variant.approval_status !== "APPROVED") errors.push("The variant is not approved.");
  if (variant.approved_revision_hash !== variant.revision_hash || (await currentHash(variant)) !== variant.revision_hash) errors.push("The approval does not match the current revision.");
  if (!variant.media_storage_key) errors.push("No rendered asset is attached.");
  if (variant.validation_status !== "valid") errors.push("The variant has not passed platform validation.");
  const destination = await getDestination(deps, variant.destination_id);
  if (!destination || destination.status !== "active" || destination.connection_status !== "active" || destination.health_state === "DISABLED") errors.push("The destination is not available.");
  if (Number.isNaN(Date.parse(input.scheduledAtUtc))) errors.push("The scheduled time is not a valid UTC timestamp.");
  if (variant.supersedes_id) {
    // The post this one replaces may already be live or still unresolved. Sending the replacement now could put both up.
    const unresolved = await deps.db.prepare(`SELECT id, slot_status FROM post_slots WHERE variant_id = ? AND slot_status IN ${POST_SEND} LIMIT 1`)
      .bind(variant.supersedes_id).first<{ id: string; slot_status: string }>();
    if (unresolved) errors.push(`The post this one replaces is still unresolved (${unresolved.slot_status}). Resolve it first.`);
  }
  // A failed post is retried by a named person with a reason, never by queueing a fresh slot around it.
  const failed = await deps.db.prepare("SELECT id FROM post_slots WHERE variant_id = ? AND destination_id = ? AND slot_status = 'FAILED' LIMIT 1")
    .bind(variant.id, variant.destination_id).first<{ id: string }>();
  if (failed) return { ok: false as const, errors: [...errors, "This post has a failed slot. Use the operator retry, with a reason."], existingSlotId: failed.id };
  if (errors.length) return { ok: false as const, errors };

  const now = iso(deps.now());
  const scheduled = new Date(input.scheduledAtUtc).toISOString();

  // One live slot per variant and destination. Queueing the same post twice must never send it twice.
  const existing = await deps.db.prepare(`SELECT id, slot_status FROM post_slots
    WHERE variant_id = ? AND destination_id = ? AND slot_status NOT IN ('CANCELED','SUPERSEDED','FAILED') LIMIT 1`)
    .bind(variant.id, variant.destination_id).first<{ id: string; slot_status: string }>();
  if (existing && existing.slot_status !== "DRAFT") {
    return { ok: false as const, errors: [`This post already has a slot for this destination (${existing.slot_status}).`], existingSlotId: existing.id };
  }
  if (existing) {
    // The slot went back to DRAFT when an edit voided approval. Re-approval revives the same slot.
    const revived = await deps.db.prepare(`UPDATE post_slots SET slot_status = 'QUEUED', scheduled_at_utc = ?, timezone = ?, idempotency_key = ?,
        approved_revision_hash = ?, attempt_count = 0, next_retry_at = NULL, uncertain_since = NULL, send_started_at = NULL, updated_at = ?
      WHERE id = ? AND slot_status = 'DRAFT'`)
      .bind(scheduled, input.timezone ?? "UTC", `${existing.id}:${variant.revision_hash}`, variant.revision_hash, now, existing.id).run();
    if (revived.meta.changes === 0) return { ok: false as const, errors: ["The slot changed while it was being queued. Try again."] };
    await audit(deps, { slotId: existing.id, variantId: variant.id, actorType: "person", actorEmail, action: "slot_requeued", metadata: { scheduledAtUtc: scheduled, revisionHash: variant.revision_hash } });
    return { ok: true as const, slotId: existing.id };
  }

  const id = deps.newId();
  try {
    await deps.db.prepare(`INSERT INTO post_slots (id, variant_id, destination_id, scheduled_at_utc, timezone, slot_status, idempotency_key,
        approved_revision_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)`)
      .bind(id, variant.id, variant.destination_id, scheduled, input.timezone ?? "UTC", `${id}:${variant.revision_hash}`, variant.revision_hash, now, now).run();
  } catch (caught) {
    // Two requests raced past the check above. The unique index is the backstop.
    if (caught instanceof Error && /unique/i.test(caught.message)) return { ok: false as const, errors: ["This post already has a slot for this destination."] };
    throw caught;
  }
  await audit(deps, { slotId: id, variantId: variant.id, actorType: "person", actorEmail, action: "slot_queued", metadata: { scheduledAtUtc: scheduled, revisionHash: variant.revision_hash } });
  return { ok: true as const, slotId: id };
}

// A person may retry a slot that failed or that reconciliation could not resolve.
// The engine never does this on its own, and the decision is recorded with the person's name.
export async function operatorRetry(deps: PostingDeps, slotId: string, actorEmail: string, reason: string) {
  requirePerson(actorEmail);
  if (!reason.trim()) throw new Error("A reason is required to retry a slot by hand.");
  const slot = await getSlot(deps, slotId);
  if (!slot || !["FAILED", "NEEDS_REVIEW"].includes(slot.slot_status)) return false;
  let result;
  try {
    result = await deps.db.prepare(`UPDATE post_slots SET slot_status = 'RETRY_READY', attempt_count = 0, next_retry_at = NULL, uncertain_since = NULL,
        send_started_at = NULL, updated_at = ? WHERE id = ? AND slot_status = ?`).bind(iso(deps.now()), slotId, slot.slot_status).run();
  } catch (caught) {
    // Another live slot for the same post already exists, so this one stays where it is.
    if (caught instanceof Error && /unique/i.test(caught.message)) return false;
    throw caught;
  }
  if (result.meta.changes === 0) return false;
  await audit(deps, { slotId, variantId: slot.variant_id, actorType: "person", actorEmail, action: "operator_retry", metadata: { from: slot.slot_status, reason } });
  return true;
}

export async function cancelSlot(deps: PostingDeps, slotId: string, actorEmail: string) {
  requirePerson(actorEmail);
  const result = await deps.db.prepare(`UPDATE post_slots SET slot_status = 'CANCELED', updated_at = ?
    WHERE id = ? AND slot_status IN ('DRAFT','READY_FOR_REVIEW','APPROVED','QUEUED','RETRY_READY','RATE_LIMITED','AUTH_REQUIRED')`)
    .bind(iso(deps.now()), slotId).run();
  if (result.meta.changes > 0) await audit(deps, { slotId, actorType: "person", actorEmail, action: "slot_canceled" });
  return result.meta.changes > 0;
}

// A person reconnected the account. Health goes back to UNVERIFIED, which lets held slots resume;
// the next send proves the connection one way or the other.
export async function markConnectionReconnected(deps: PostingDeps, connectionId: string, actorEmail: string) {
  requirePerson(actorEmail);
  const now = iso(deps.now());
  const result = await deps.db.prepare("UPDATE social_connections SET health_state = 'UNVERIFIED', health_checked_at = ?, updated_at = ? WHERE id = ? AND health_state = 'AUTH_REQUIRED'")
    .bind(now, now, connectionId).run();
  if (result.meta.changes > 0) await audit(deps, { actorType: "person", actorEmail, action: "connection_reconnected", metadata: { connectionId } });
  return result.meta.changes > 0;
}

// Display helper. Storage is always UTC; the timezone is only for people.
export function localDisplay(scheduledAtUtc: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(scheduledAtUtc));
}

async function requireVariant(deps: PostingDeps, id: string) {
  const variant = await getVariant(deps, id);
  if (!variant) throw new Error("The post variant was not found.");
  return variant;
}

export { getSlot };
