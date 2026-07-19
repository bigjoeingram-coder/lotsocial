import { env } from "cloudflare:workers";
import { PERMISSIONS, PermissionId } from "./authorization-shared";

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

let schemaReady: Promise<void> | null = null;

function database() {
  if (!env.DB) throw new Error("The authorization database is unavailable.");
  return env.DB;
}

export function ensureAuthorizationSchema() {
  if (!schemaReady) {
    const db = database();
    schemaReady = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS authorization_requests (
        id TEXT PRIMARY KEY,
        approval_token_hash TEXT NOT NULL UNIQUE,
        dealership_name TEXT NOT NULL,
        rooftop_location TEXT NOT NULL,
        dealership_domain TEXT NOT NULL DEFAULT '',
        associate_name TEXT NOT NULL,
        associate_email TEXT NOT NULL,
        manager_name TEXT NOT NULL,
        manager_title TEXT NOT NULL,
        manager_email TEXT NOT NULL,
        manager_phone TEXT NOT NULL DEFAULT '',
        provider_name TEXT NOT NULL DEFAULT 'Unknown',
        provider_contact_name TEXT NOT NULL DEFAULT '',
        provider_contact_email TEXT NOT NULL DEFAULT '',
        requested_permissions TEXT NOT NULL,
        approved_permissions TEXT,
        status TEXT NOT NULL DEFAULT 'requested',
        email_delivery_status TEXT NOT NULL DEFAULT 'pending',
        email_message_id TEXT,
        typed_signature TEXT,
        manager_notes TEXT NOT NULL DEFAULT '',
        terms_version TEXT NOT NULL DEFAULT '2026-07-18-v1',
        requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        decided_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS authorization_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_email TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS authorization_requests_status_idx ON authorization_requests(status, requested_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS authorization_audit_request_idx ON authorization_audit_events(request_id, created_at ASC)"),
    ]).then(() => undefined);
  }
  return schemaReady;
}

export function createSecureToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listAuthorizationRequests(limit = 20) {
  await ensureAuthorizationSchema();
  const result = await database()
    .prepare(`SELECT id, dealership_name, rooftop_location, associate_name, associate_email,
      manager_name, manager_title, manager_email, provider_name, requested_permissions,
      approved_permissions, status, email_delivery_status, requested_at, decided_at, expires_at
      FROM authorization_requests ORDER BY requested_at DESC LIMIT ?`)
    .bind(limit)
    .all<AuthorizationRequestRecord>();
  return result.results;
}

export async function getAuthorizationByToken(token: string) {
  await ensureAuthorizationSchema();
  const tokenHash = await hashToken(token);
  return database()
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
) {
  await ensureAuthorizationSchema();
  await database()
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
}) {
  await ensureAuthorizationSchema();
  await database()
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
  });
}

export async function setEmailDelivery(id: string, status: string, messageId?: string) {
  await database()
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
}) {
  const record = await getAuthorizationByToken(input.token);
  if (!record) return null;
  if (record.status !== "requested") return { record, alreadyDecided: true };

  const status = input.decision === "approved" ? "manager_approved" : "declined";
  await database()
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
  });
  return { record: { ...record, status }, alreadyDecided: false };
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
