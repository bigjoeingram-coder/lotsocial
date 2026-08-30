import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { PERMISSIONS, PermissionId } from "./authorization-shared.ts";

export { PERMISSIONS };
export type { PermissionId };

export type AuthorizationRequestRecord = {
  id: string;
  dealership_name: string;
  rooftop_location: string;
  dealership_domain: string;
  associate_name: string;
  associate_email: string;
  manager_name: string;
  manager_title: string;
  manager_email: string;
  manager_phone: string;
  provider_name: string;
  provider_contact_name: string;
  provider_contact_email: string;
  requested_permissions: string;
  approved_permissions: string | null;
  status: string;
  email_delivery_status: string;
  email_message_id: string | null;
  typed_signature: string | null;
  manager_notes: string;
  terms_version: string;
  requested_at: string;
  decided_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AuthorizationAuditEvent = {
  id: number;
  request_id: string;
  actor_type: string;
  actor_email: string;
  action: string;
  metadata: string;
  created_at: string;
};

export type ProviderVerificationRecord = {
  request_id: string;
  verification_token_hash: string;
  provider_name: string;
  contact_name: string;
  contact_email: string;
  delivery_method: string;
  feed_format: string;
  connection_notes: string;
  status: string;
  typed_signature: string | null;
  created_at: string;
  decided_at: string | null;
  updated_at: string;
};

export function ensureAuthorizationSchema(env?: LotSocialEnvironment) {
  return ensureLotSocialSchema(env);
}

export function createSecureToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listAuthorizationRequests(associateEmail: string, limit = 20, env?: LotSocialEnvironment) {
  await ensureAuthorizationSchema(env);
  const result = await database(env, "authorization")
    .prepare(`SELECT id, dealership_name, rooftop_location, associate_name, associate_email,
      manager_name, manager_title, manager_email, provider_name, requested_permissions,
      approved_permissions, status, email_delivery_status, requested_at, decided_at, expires_at
      FROM authorization_requests WHERE LOWER(associate_email) = LOWER(?)
      ORDER BY requested_at DESC LIMIT ?`)
    .bind(associateEmail, limit)
    .all<AuthorizationRequestRecord>();
  return result.results;
}

export async function getAuthorizationById(id: string, env?: LotSocialEnvironment) {
  await ensureAuthorizationSchema(env);
  return database(env, "authorization")
    .prepare("SELECT * FROM authorization_requests WHERE id = ? LIMIT 1")
    .bind(id)
    .first<AuthorizationRequestRecord>();
}

export async function getAuthorizationByIdForAssociate(id: string, associateEmail: string, env?: LotSocialEnvironment) {
  await ensureAuthorizationSchema(env);
  return database(env, "authorization")
    .prepare("SELECT * FROM authorization_requests WHERE id = ? AND LOWER(associate_email) = LOWER(?) LIMIT 1")
    .bind(id, associateEmail)
    .first<AuthorizationRequestRecord>();
}

export async function listAuditEvents(requestId: string, env?: LotSocialEnvironment) {
  await ensureAuthorizationSchema(env);
  const result = await database(env, "authorization")
    .prepare("SELECT * FROM authorization_audit_events WHERE request_id = ? ORDER BY created_at DESC, id DESC")
    .bind(requestId)
    .all<AuthorizationAuditEvent>();
  return result.results;
}

export async function getProviderVerification(requestId: string, env?: LotSocialEnvironment) {
  await ensureAuthorizationSchema(env);
  return database(env, "authorization")
    .prepare("SELECT * FROM provider_verifications WHERE request_id = ? LIMIT 1")
    .bind(requestId)
    .first<ProviderVerificationRecord>();
}

export async function createProviderVerificationInvite(input: {
  record: AuthorizationRequestRecord;
  tokenHash: string;
  providerName: string;
  contactName: string;
  contactEmail: string;
  env?: LotSocialEnvironment;
}) {
  await ensureAuthorizationSchema(input.env);
  const db = database(input.env, "authorization");
  await db.batch([
    db.prepare(`INSERT INTO provider_verifications (
      request_id, verification_token_hash, provider_name, contact_name, contact_email, status
    ) VALUES (?, ?, ?, ?, ?, 'pending') ON CONFLICT(request_id) DO UPDATE SET
      verification_token_hash = excluded.verification_token_hash,
      provider_name = excluded.provider_name,
      contact_name = excluded.contact_name,
      contact_email = excluded.contact_email,
      delivery_method = '', feed_format = '', connection_notes = '',
      status = 'pending', typed_signature = NULL, decided_at = NULL,
      updated_at = CURRENT_TIMESTAMP`)
      .bind(input.record.id, input.tokenHash, input.providerName, input.contactName, input.contactEmail),
    db.prepare(`UPDATE authorization_requests SET provider_name = ?,
      provider_contact_name = ?, provider_contact_email = ?, status = 'provider_pending',
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(input.providerName, input.contactName, input.contactEmail, input.record.id),
  ]);
  await addAuditEvent(input.record.id, "associate", input.record.associate_email, "provider_verification_invited", {
    providerName: input.providerName,
    contactEmail: input.contactEmail,
  }, input.env);
}

export async function getProviderVerificationByToken(token: string, env?: LotSocialEnvironment) {
  await ensureAuthorizationSchema(env);
  const tokenHash = await hashToken(token);
  return database(env, "authorization")
    .prepare(`SELECT pv.*, ar.dealership_name, ar.rooftop_location, ar.associate_name,
      ar.requested_permissions, ar.approved_permissions, ar.manager_name
      FROM provider_verifications pv JOIN authorization_requests ar ON ar.id = pv.request_id
      WHERE pv.verification_token_hash = ? LIMIT 1`)
    .bind(tokenHash)
    .first<ProviderVerificationRecord & AuthorizationRequestRecord>();
}

export async function decideProviderVerification(input: {
  token: string;
  decision: "verified" | "declined";
  providerName: string;
  contactName: string;
  contactEmail: string;
  deliveryMethod: string;
  feedFormat: string;
  connectionNotes: string;
  typedSignature: string;
  env?: LotSocialEnvironment;
}) {
  const verification = await getProviderVerificationByToken(input.token, input.env);
  if (!verification) return null;
  if (verification.status !== "pending") return { verification, alreadyDecided: true };

  const requestStatus = input.decision === "verified" ? "provider_verified" : "provider_declined";
  const db = database(input.env, "authorization");
  await db.batch([
    db.prepare(`UPDATE provider_verifications SET status = ?, provider_name = ?,
      contact_name = ?, contact_email = ?, delivery_method = ?, feed_format = ?,
      connection_notes = ?, typed_signature = ?, decided_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP WHERE request_id = ?`)
      .bind(input.decision, input.providerName, input.contactName, input.contactEmail,
        input.deliveryMethod, input.feedFormat, input.connectionNotes, input.typedSignature,
        verification.request_id),
    db.prepare(`UPDATE authorization_requests SET status = ?, provider_name = ?,
      provider_contact_name = ?, provider_contact_email = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`)
      .bind(requestStatus, input.providerName, input.contactName, input.contactEmail, verification.request_id),
  ]);
  await addAuditEvent(verification.request_id, "provider", input.contactEmail,
    input.decision === "verified" ? "provider_rights_verified" : "provider_verification_declined", {
      providerName: input.providerName,
      deliveryMethod: input.deliveryMethod,
      feedFormat: input.feedFormat,
    }, input.env);
  return { verification: { ...verification, status: input.decision }, alreadyDecided: false };
}

export function evaluateAuthorization(record: AuthorizationRequestRecord | null, permission: PermissionId) {
  if (!record) return { allowed: false, reason: "authorization_not_found" } as const;
  if (record.status !== "active") return { allowed: false, reason: `status_${record.status}` } as const;
  if (record.expires_at && new Date(`${record.expires_at}T23:59:59Z`).getTime() < Date.now()) {
    return { allowed: false, reason: "authorization_expired" } as const;
  }
  if (!parsePermissions(record.approved_permissions).includes(permission)) {
    return { allowed: false, reason: "permission_not_approved" } as const;
  }
  return { allowed: true, reason: "authorized" } as const;
}

export async function getAuthorizationByToken(token: string, env?: LotSocialEnvironment) {
  await ensureAuthorizationSchema(env);
  const tokenHash = await hashToken(token);
  return database(env, "authorization")
    .prepare("SELECT * FROM authorization_requests WHERE approval_token_hash = ? LIMIT 1")
    .bind(tokenHash)
    .first<AuthorizationRequestRecord>();
}

export async function addAuditEvent(
  requestId: string,
  actorType: string,
  actorEmail: string,
  action: string,
  metadata: Record<string, unknown> = {},
  env?: LotSocialEnvironment,
) {
  await ensureAuthorizationSchema(env);
  await database(env, "authorization")
    .prepare("INSERT INTO authorization_audit_events (request_id, actor_type, actor_email, action, metadata) VALUES (?, ?, ?, ?, ?)")
    .bind(requestId, actorType, actorEmail, action, JSON.stringify(metadata))
    .run();
}

export async function createAuthorizationRequest(input: {
  id: string;
  tokenHash: string;
  dealershipName: string;
  rooftopLocation: string;
  dealershipDomain: string;
  associateName: string;
  associateEmail: string;
  managerName: string;
  managerTitle: string;
  managerEmail: string;
  managerPhone: string;
  providerName: string;
  providerContactName: string;
  providerContactEmail: string;
  requestedPermissions: PermissionId[];
  env?: LotSocialEnvironment;
}) {
  await ensureAuthorizationSchema(input.env);
  await database(input.env, "authorization")
    .prepare(`INSERT INTO authorization_requests (
      id, approval_token_hash, dealership_name, rooftop_location, dealership_domain,
      associate_name, associate_email, manager_name, manager_title, manager_email,
      manager_phone, provider_name, provider_contact_name, provider_contact_email,
      requested_permissions, status, email_delivery_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', 'pending')`)
    .bind(
      input.id, input.tokenHash, input.dealershipName, input.rooftopLocation,
      input.dealershipDomain, input.associateName, input.associateEmail,
      input.managerName, input.managerTitle, input.managerEmail, input.managerPhone,
      input.providerName, input.providerContactName, input.providerContactEmail,
      JSON.stringify(input.requestedPermissions),
    )
    .run();
  await addAuditEvent(input.id, "associate", input.associateEmail, "permission_requested", {
    managerEmail: input.managerEmail,
    permissions: input.requestedPermissions,
  }, input.env);
}

export async function setEmailDelivery(id: string, status: string, messageId?: string, env?: LotSocialEnvironment) {
  await database(env, "authorization")
    .prepare("UPDATE authorization_requests SET email_delivery_status = ?, email_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(status, messageId ?? null, id)
    .run();
}

export async function decideAuthorization(input: {
  token: string;
  decision: "approved" | "declined";
  typedSignature: string;
  approvedPermissions: PermissionId[];
  providerName: string;
  providerContactName: string;
  providerContactEmail: string;
  expiresAt: string | null;
  managerNotes: string;
  env?: LotSocialEnvironment;
}) {
  const record = await getAuthorizationByToken(input.token, input.env);
  if (!record) return null;
  if (record.status !== "requested") return { record, alreadyDecided: true };

  const status = input.decision === "approved" ? "manager_approved" : "declined";
  await database(input.env, "authorization")
    .prepare(`UPDATE authorization_requests SET status = ?, approved_permissions = ?,
      typed_signature = ?, provider_name = ?, provider_contact_name = ?,
      provider_contact_email = ?, expires_at = ?, manager_notes = ?,
      decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(
      status,
      JSON.stringify(input.approvedPermissions),
      input.typedSignature,
      input.providerName,
      input.providerContactName,
      input.providerContactEmail,
      input.expiresAt,
      input.managerNotes,
      record.id,
    )
    .run();
  await addAuditEvent(record.id, "manager", record.manager_email, status, {
    permissions: input.approvedPermissions,
    providerName: input.providerName,
    expiresAt: input.expiresAt,
    termsVersion: record.terms_version,
  }, input.env);
  return { record: { ...record, status }, alreadyDecided: false };
}

export async function manageAuthorization(input: {
  token: string;
  action: "update" | "suspend" | "revoke";
  approvedPermissions: PermissionId[];
  expiresAt: string | null;
  managerNotes: string;
  env?: LotSocialEnvironment;
}) {
  const record = await getAuthorizationByToken(input.token, input.env);
  if (!record) return null;

  const manageableStatuses = ["manager_approved", "provider_pending", "provider_verified", "provider_declined", "feed_connected", "active", "suspended"];
  if (!manageableStatuses.includes(record.status)) return { record, unavailable: true };

  const nextStatus = input.action === "revoke"
    ? "revoked"
    : input.action === "suspend"
      ? "suspended"
      : record.status === "suspended" ? "manager_approved" : record.status;
  const nextPermissions = input.action === "revoke" ? [] : input.approvedPermissions;

  await database(input.env, "authorization")
    .prepare(`UPDATE authorization_requests SET status = ?, approved_permissions = ?,
      expires_at = ?, manager_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(nextStatus, JSON.stringify(nextPermissions), input.expiresAt, input.managerNotes, record.id)
    .run();

  const auditAction = input.action === "revoke"
    ? "manager_access_revoked"
    : input.action === "suspend"
      ? "manager_access_suspended"
      : record.status === "suspended" ? "manager_access_resumed" : "manager_permissions_updated";
  await addAuditEvent(record.id, "manager", record.manager_email, auditAction, {
    previousStatus: record.status,
    status: nextStatus,
    permissions: nextPermissions,
    expiresAt: input.expiresAt,
    notes: input.managerNotes,
  }, input.env);

  return { record: { ...record, status: nextStatus, approved_permissions: JSON.stringify(nextPermissions) }, unavailable: false };
}

export function parsePermissions(value: string | null): PermissionId[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is PermissionId =>
      PERMISSIONS.some((permission) => permission.id === item)) : [];
  } catch {
    return [];
  }
}
