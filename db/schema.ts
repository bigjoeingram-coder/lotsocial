import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const pilotInvites = sqliteTable("pilot_invites", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  dealershipName: text("dealership_name").notNull(),
  dealershipDomain: text("dealership_domain").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("pilot_invites_email_idx").on(table.email, table.createdAt)]);

export const associateAccounts = sqliteTable("associate_accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  phone: text("phone").notNull().default(""),
  dealershipName: text("dealership_name").notNull(),
  dealershipDomain: text("dealership_domain").notNull(),
  rooftopLocation: text("rooftop_location").notNull().default(""),
  profilePhotoUrl: text("profile_photo_url").notNull().default(""),
  role: text("role").notNull().default("associate"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const associateSessions = sqliteTable("associate_sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("associate_sessions_account_idx").on(table.accountId, table.createdAt),
  index("associate_sessions_expiry_idx").on(table.expiresAt),
]);

export const accountLoginLinks = sqliteTable("account_login_links", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("account_login_links_account_idx").on(table.accountId, table.createdAt)]);

export const authorizationRequests = sqliteTable("authorization_requests", {
  id: text("id").primaryKey(),
  approvalTokenHash: text("approval_token_hash").notNull().unique(),
  dealershipName: text("dealership_name").notNull(),
  rooftopLocation: text("rooftop_location").notNull(),
  dealershipDomain: text("dealership_domain").notNull().default(""),
  associateName: text("associate_name").notNull(),
  associateEmail: text("associate_email").notNull(),
  managerName: text("manager_name").notNull(),
  managerTitle: text("manager_title").notNull(),
  managerEmail: text("manager_email").notNull(),
  managerPhone: text("manager_phone").notNull().default(""),
  providerName: text("provider_name").notNull().default("Unknown"),
  providerContactName: text("provider_contact_name").notNull().default(""),
  providerContactEmail: text("provider_contact_email").notNull().default(""),
  requestedPermissions: text("requested_permissions").notNull(),
  approvedPermissions: text("approved_permissions"),
  status: text("status").notNull().default("requested"),
  emailDeliveryStatus: text("email_delivery_status").notNull().default("pending"),
  emailMessageId: text("email_message_id"),
  typedSignature: text("typed_signature"),
  managerNotes: text("manager_notes").notNull().default(""),
  termsVersion: text("terms_version").notNull().default("2026-09-14-v2"),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  decidedAt: text("decided_at"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("authorization_requests_status_idx").on(table.status, table.requestedAt),
]);

export const authorizationAuditEvents = sqliteTable("authorization_audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestId: text("request_id").notNull(),
  actorType: text("actor_type").notNull(),
  actorEmail: text("actor_email").notNull().default(""),
  action: text("action").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("authorization_audit_request_idx").on(table.requestId, table.createdAt),
]);

export const providerVerifications = sqliteTable("provider_verifications", {
  requestId: text("request_id").primaryKey(),
  verificationTokenHash: text("verification_token_hash").notNull().unique(),
  providerName: text("provider_name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  deliveryMethod: text("delivery_method").notNull().default(""),
  feedFormat: text("feed_format").notNull().default(""),
  connectionNotes: text("connection_notes").notNull().default(""),
  status: text("status").notNull().default("pending"),
  typedSignature: text("typed_signature"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  decidedAt: text("decided_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const authorizationManagementLinks = sqliteTable("authorization_management_links", {
  requestId: text("request_id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("authorization_management_links_expiry_idx").on(table.expiresAt),
]);

export const importedVehicles = sqliteTable("imported_vehicles", {
  id: text("id").primaryKey(),
  associateEmail: text("associate_email").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceHost: text("source_host").notNull(),
  title: text("title").notNull(),
  vin: text("vin").notNull().default(""),
  stockNumber: text("stock_number").notNull().default(""),
  year: text("year").notNull().default(""),
  make: text("make").notNull().default(""),
  model: text("model").notNull().default(""),
  trim: text("trim").notNull().default(""),
  price: text("price").notNull().default(""),
  currency: text("currency").notNull().default("USD"),
  description: text("description").notNull().default(""),
  imageUrls: text("image_urls").notNull().default("[]"),
  facts: text("facts").notNull().default("{}"),
  sourceType: text("source_type").notNull().default("vdp_one_time"),
  authorizationCertifiedAt: text("authorization_certified_at").notNull(),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("imported_vehicles_associate_idx").on(table.associateEmail, table.importedAt),
  uniqueIndex("imported_vehicles_associate_source_unique").on(table.associateEmail, table.sourceUrl),
]);

export const importEvidence = sqliteTable("import_evidence", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  associateEmail: text("associate_email").notNull(),
  dealershipTenant: text("dealership_tenant").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceHost: text("source_host").notNull(),
  capturedAt: text("captured_at").notNull(),
  contentSha256: text("content_sha256").notNull(),
  htmlStorageKey: text("html_storage_key").notNull(),
  screenshotStorageKey: text("screenshot_storage_key").notNull().default(""),
  screenshotStatus: text("screenshot_status").notNull().default("unavailable"),
  priceAtCapture: text("price_at_capture").notNull().default(""),
  currency: text("currency").notNull().default("USD"),
  vinAtCapture: text("vin_at_capture").notNull().default(""),
  stockAtCapture: text("stock_at_capture").notNull().default(""),
  titleAtCapture: text("title_at_capture").notNull(),
  purposeProjectId: text("purpose_project_id"),
  purposeNote: text("purpose_note").notNull(),
  sourceType: text("source_type").notNull().default("vdp_one_time"),
  contentType: text("content_type").notNull().default("text/html; charset=utf-8"),
  storageBytes: integer("storage_bytes").notNull().default(0),
}, (table) => [
  index("import_evidence_vehicle_idx").on(table.vehicleId, table.capturedAt),
  index("import_evidence_tenant_idx").on(table.dealershipTenant, table.capturedAt),
  index("import_evidence_associate_idx").on(table.associateEmail, table.capturedAt),
]);

export const creativeProjects = sqliteTable("creative_projects", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  associateEmail: text("associate_email").notNull(),
  selectedImages: text("selected_images").notNull().default("[]"),
  style: text("style").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(30),
  voiceoverScript: text("voiceover_script").notNull(),
  socialCaption: text("social_caption").notNull(),
  endCardName: text("end_card_name").notNull(),
  endCardPhone: text("end_card_phone").notNull().default(""),
  endCardEmail: text("end_card_email").notNull().default(""),
  endCardCta: text("end_card_cta").notNull().default("Message me for details"),
  endCardPhotoUrl: text("end_card_photo_url").notNull().default(""),
  disclaimerVersion: text("disclaimer_version").notNull().default("2026-09-14-v1"),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("creative_projects_associate_idx").on(table.associateEmail, table.createdAt),
  index("creative_projects_vehicle_idx").on(table.vehicleId, table.createdAt),
]);

export const creativeRenderJobs = sqliteTable("creative_render_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  associateEmail: text("associate_email").notNull(),
  provider: text("provider").notNull().default("shotstack"),
  providerRenderId: text("provider_render_id").notNull().default(""),
  status: text("status").notNull().default("prepared"),
  renderPlan: text("render_plan").notNull(),
  outputUrl: text("output_url").notNull().default(""),
  storageKey: text("storage_key").notNull().default(""),
  errorMessage: text("error_message").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("creative_render_jobs_project_idx").on(table.projectId, table.createdAt),
  index("creative_render_jobs_associate_idx").on(table.associateEmail, table.createdAt),
]);

export const rateLimitCounters = sqliteTable("rate_limit_counters", {
  counterKey: text("counter_key").notNull(),
  counterScope: text("counter_scope").notNull(),
  counterSubject: text("counter_subject").notNull(),
  counterDay: text("counter_day").notNull(),
  count: integer("count").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.counterKey, table.counterDay] }),
  index("rate_limit_counters_scope_day_idx").on(table.counterScope, table.counterDay),
]);

export const importOutcomes = sqliteTable("import_outcomes", {
  id: text("id").primaryKey(),
  associateEmail: text("associate_email").notNull(),
  sourceHost: text("source_host").notNull(),
  outcome: text("outcome").notNull(),
  elapsedMs: integer("elapsed_ms").notNull(),
  fallback: text("fallback").notNull().default("none"),
  brightDataUsed: integer("bright_data_used").notNull().default(0),
  notice: text("notice").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("import_outcomes_created_idx").on(table.createdAt),
  index("import_outcomes_host_created_idx").on(table.sourceHost, table.createdAt),
]);

// Posting engine v1. Spec: docs/posting-engine/CHECKPOINT-1.md.
// Tokens are never stored here: credentials_ref names the secret that holds them.
export const socialConnections = sqliteTable("social_connections", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  platform: text("platform").notNull(),
  accountLabel: text("account_label").notNull().default(""),
  credentialsRef: text("credentials_ref").notNull().default(""),
  grantedScopes: text("granted_scopes").notNull().default("[]"),
  healthState: text("health_state").notNull().default("UNVERIFIED"),
  healthCheckedAt: text("health_checked_at"),
  lastSuccessAt: text("last_success_at"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("social_connections_owner_idx").on(table.ownerEmail, table.platform),
]);

export const socialDestinations = sqliteTable("social_destinations", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  platform: text("platform").notNull(),
  platformRef: text("platform_ref").notNull(),
  kind: text("kind").notNull().default("member"),
  displayName: text("display_name").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("social_destinations_connection_ref_unique").on(table.connectionId, table.platformRef),
]);

export const postVariants = sqliteTable("post_variants", {
  id: text("id").primaryKey(),
  creativeProjectId: text("creative_project_id").notNull(),
  destinationId: text("destination_id").notNull(),
  platform: text("platform").notNull(),
  caption: text("caption").notNull().default(""),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  platformOptions: text("platform_options").notNull().default("{}"),
  renderJobId: text("render_job_id").notNull().default(""),
  mediaStorageKey: text("media_storage_key").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  revisionHash: text("revision_hash").notNull(),
  approvalStatus: text("approval_status").notNull().default("DRAFT"),
  approvedRevisionHash: text("approved_revision_hash").notNull().default(""),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: text("approved_at"),
  validationStatus: text("validation_status").notNull().default("unchecked"),
  validationErrors: text("validation_errors").notNull().default("[]"),
  supersedesId: text("supersedes_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("post_variants_project_idx").on(table.creativeProjectId, table.createdAt),
]);

export const postSlots = sqliteTable("post_slots", {
  id: text("id").primaryKey(),
  variantId: text("variant_id").notNull(),
  destinationId: text("destination_id").notNull(),
  scheduledAtUtc: text("scheduled_at_utc").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  slotStatus: text("slot_status").notNull().default("DRAFT"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  approvedRevisionHash: text("approved_revision_hash").notNull().default(""),
  workerId: text("worker_id").notNull().default(""),
  attemptId: text("attempt_id").notNull().default(""),
  claimedAt: text("claimed_at"),
  leaseExpiresAt: text("lease_expires_at"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextRetryAt: text("next_retry_at"),
  uncertainSince: text("uncertain_since"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("post_slots_due_idx").on(table.slotStatus, table.scheduledAtUtc),
  index("post_slots_lease_idx").on(table.slotStatus, table.leaseExpiresAt),
  index("post_slots_variant_idx").on(table.variantId),
]);

export const deliveryAttempts = sqliteTable("delivery_attempts", {
  id: text("id").primaryKey(),
  slotId: text("slot_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  adapter: text("adapter").notNull(),
  requestSnapshot: text("request_snapshot").notNull().default("{}"),
  outcome: text("outcome").notNull().default("in_flight"),
  platformPostId: text("platform_post_id").notNull().default(""),
  platformUrl: text("platform_url").notNull().default(""),
  providerRequestId: text("provider_request_id").notNull().default(""),
  errorCode: text("error_code").notNull().default(""),
  errorMessage: text("error_message").notNull().default(""),
  retryable: integer("retryable").notNull().default(0),
  rawResponseKey: text("raw_response_key").notNull().default(""),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  lastCheckedAt: text("last_checked_at"),
}, (table) => [
  index("delivery_attempts_slot_idx").on(table.slotId, table.startedAt),
]);

export const postingAuditEvents = sqliteTable("posting_audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slotId: text("slot_id").notNull().default(""),
  variantId: text("variant_id").notNull().default(""),
  actorType: text("actor_type").notNull(),
  actorEmail: text("actor_email").notNull().default(""),
  action: text("action").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("posting_audit_slot_idx").on(table.slotId, table.createdAt),
  index("posting_audit_variant_idx").on(table.variantId, table.createdAt),
]);
