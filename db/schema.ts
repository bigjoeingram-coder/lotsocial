import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  termsVersion: text("terms_version").notNull().default("2026-07-18-v1"),
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
