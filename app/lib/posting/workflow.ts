import type { PostingDeps, VariantRow } from "./engine.ts";
import { audit, currentHash, getDestination, getSlot, getVariant, iso, snapshot } from "./engine.ts";
import { revisionHash } from "./revision.ts";

export type NewVariant = {
  creativeProjectId: string; destinationId: string; platform: string; caption: string;
  title?: string; description?: string; platformOptions?: Record<string, unknown>;
  renderJobId?: string; mediaStorageKey?: string; supersedesId?: string;
};

const EDITABLE = { caption: "caption", title: "title", description: "description", platformOptions: "platform_options", mediaStorageKey: "media_storage_key", renderJobId: "render_job_id" } as const;

export async function createVariant(deps: PostingDeps, input: NewVariant, actorEmail: string) {
  const id = deps.newId();
  const platformOptions = JSON.stringify(input.platformOptions ?? {});
  const hash = await revisionHash({
    platform: input.platform, destinationId: input.destinationId, caption: input.caption, title: input.title ?? "",
    description: input.description ?? "", platformOptions, mediaStorageKey: input.mediaStorageKey ?? "",
  });
  const now = iso(deps.now());
  await deps.db.prepare(`INSERT INTO post_variants (id, creative_project_id, destination_id, platform, caption, title, description,
      platform_options, render_job_id, media_storage_key, revision, revision_hash, supersedes_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
    .bind(id, input.creativeProjectId, input.destinationId, input.platform, input.caption, input.title ?? "", input.description ?? "",
      platformOptions, input.renderJobId ?? "", input.mediaStorageKey ?? "", hash, input.supersedesId ?? null, now, now).run();
  if (input.supersedesId) {
    await deps.db.prepare(`UPDATE post_slots SET slot_status = 'SUPERSEDED', updated_at = ?
      WHERE variant_id = ? AND slot_status IN ('DRAFT','READY_FOR_REVIEW','APPROVED','QUEUED','RETRY_READY','RATE_LIMITED','AUTH_REQUIRED')`)
      .bind(now, input.supersedesId).run();
    await audit(deps, { variantId: input.supersedesId, actorType: "person", actorEmail, action: "variant_superseded", metadata: { by: id } });
  }
  await audit(deps, { variantId: id, actorType: "person", actorEmail, action: "variant_created", metadata: { revisionHash: hash } });
  return id;
}

// Any edit to a publish-affecting field makes a new revision and voids approval.
// Slots that were waiting on the old approval go back to DRAFT and cannot send.
export async function editVariant(deps: PostingDeps, variantId: string, changes: Partial<Record<keyof typeof EDITABLE, unknown>>, actorEmail: string) {
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
      render_job_id = ?, revision = revision + 1, revision_hash = ?, approval_status = 'DRAFT', approved_revision_hash = '',
      approved_by = '', approved_at = NULL, validation_status = 'unchecked', validation_errors = '[]', updated_at = ?
    WHERE id = ?`)
    .bind(next.caption, next.title, next.description, next.platform_options, next.media_storage_key, next.render_job_id, hash, now, variantId).run();
  await deps.db.prepare(`UPDATE post_slots SET slot_status = 'DRAFT', approved_revision_hash = '', updated_at = ?
    WHERE variant_id = ? AND slot_status IN ('READY_FOR_REVIEW','APPROVED','QUEUED','RETRY_READY','RATE_LIMITED','AUTH_REQUIRED')`)
    .bind(now, variantId).run();
  await audit(deps, { variantId, actorType: "person", actorEmail, action: "variant_edited_approval_void", metadata: { from: variant.revision_hash, to: hash } });
  return hash;
}

export async function approveVariant(deps: PostingDeps, variantId: string, approverEmail: string) {
  const variant = await requireVariant(deps, variantId);
  const adapter = deps.adapters[variant.platform];
  if (!adapter) throw new Error(`No adapter is registered for ${variant.platform}.`);
  if (!variant.media_storage_key) return reject(deps, variant, ["A rendered asset is required before approval."]);
  const validation = adapter.validateContent(snapshot(variant));
  if (!validation.ok) return reject(deps, variant, validation.errors);
  const hash = await currentHash(variant);
  const now = iso(deps.now());
  await deps.db.prepare(`UPDATE post_variants SET approval_status = 'APPROVED', approved_revision_hash = ?, approved_by = ?, approved_at = ?,
      validation_status = 'valid', validation_errors = '[]', updated_at = ? WHERE id = ? AND revision_hash = ?`)
    .bind(hash, approverEmail, now, now, variantId, hash).run();
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
  const variant = await requireVariant(deps, input.variantId);
  const errors: string[] = [];
  if (variant.approval_status !== "APPROVED") errors.push("The variant is not approved.");
  if (variant.approved_revision_hash !== variant.revision_hash || (await currentHash(variant)) !== variant.revision_hash) errors.push("The approval does not match the current revision.");
  if (!variant.media_storage_key) errors.push("No rendered asset is attached.");
  if (variant.validation_status !== "valid") errors.push("The variant has not passed platform validation.");
  const destination = await getDestination(deps, variant.destination_id);
  if (!destination || destination.status !== "active" || destination.connection_status !== "active" || destination.health_state === "DISABLED") errors.push("The destination is not available.");
  if (Number.isNaN(Date.parse(input.scheduledAtUtc))) errors.push("The scheduled time is not a valid UTC timestamp.");
  if (errors.length) return { ok: false as const, errors };

  const id = deps.newId();
  const now = iso(deps.now());
  const scheduled = new Date(input.scheduledAtUtc).toISOString();
  await deps.db.prepare(`INSERT INTO post_slots (id, variant_id, destination_id, scheduled_at_utc, timezone, slot_status, idempotency_key,
      approved_revision_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)`)
    .bind(id, variant.id, variant.destination_id, scheduled, input.timezone ?? "UTC", `${id}:${variant.revision_hash}`, variant.revision_hash, now, now).run();
  await audit(deps, { slotId: id, variantId: variant.id, actorType: "person", actorEmail, action: "slot_queued", metadata: { scheduledAtUtc: scheduled, revisionHash: variant.revision_hash } });
  return { ok: true as const, slotId: id };
}

export async function cancelSlot(deps: PostingDeps, slotId: string, actorEmail: string) {
  const result = await deps.db.prepare(`UPDATE post_slots SET slot_status = 'CANCELED', updated_at = ?
    WHERE id = ? AND slot_status IN ('DRAFT','READY_FOR_REVIEW','APPROVED','QUEUED','RETRY_READY','RATE_LIMITED','AUTH_REQUIRED')`)
    .bind(iso(deps.now()), slotId).run();
  if (result.meta.changes > 0) await audit(deps, { slotId, actorType: "person", actorEmail, action: "slot_canceled" });
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
