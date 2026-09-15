import { createSecureToken, hashToken } from "./authorization.ts";
import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

export const SESSION_COOKIE = "lotsocial_session";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PilotInviteRecord = {
  id: string;
  email: string;
  dealership_name: string;
  dealership_domain: string;
  expires_at: string;
  used_at: string | null;
};

export type AssociateAccountRecord = {
  id: string;
  email: string;
  display_name: string;
  phone: string;
  dealership_name: string;
  dealership_domain: string;
  rooftop_location: string;
  profile_photo_url: string;
  role: "associate" | "manager" | "admin";
  status: string;
};

export type AccountUser = {
  accountId: string;
  displayName: string;
  email: string;
  fullName: string;
  phone: string;
  dealershipName: string;
  dealershipDomain: string;
  rooftopLocation: string;
  profilePhotoUrl: string;
  role: "associate" | "manager" | "admin";
};

export function normalizeWorkEmail(value: string) {
  const email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : "";
}

export function normalizeDealerDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "").replace(/:\d+$/, "");
}

export function normalizePhone(value: string) {
  const cleaned = value.trim().replace(/[^\d+().\-\s]/g, "").replace(/\s+/g, " ");
  const digits = cleaned.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? cleaned : "";
}

export async function createPilotInvite(input: {
  email: string;
  dealershipName: string;
  dealershipDomain: string;
  ttlHours?: number;
  env: LotSocialEnvironment;
}) {
  const email = normalizeWorkEmail(input.email);
  const dealershipName = input.dealershipName.trim();
  const dealershipDomain = normalizeDealerDomain(input.dealershipDomain);
  if (!email || !dealershipName || !dealershipDomain) throw new Error("Work email, dealership name, and dealership website are required.");
  if (!email.endsWith(`@${dealershipDomain}`)) throw new Error("Pilot invitations must use the dealership's work-email domain.");

  await ensureLotSocialSchema(input.env);
  const token = createSecureToken();
  const ttlHours = Math.min(Math.max(input.ttlHours ?? 72, 1), 168);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();
  await database(input.env, "LotSocial accounts").prepare(`INSERT INTO pilot_invites
      (id, token_hash, email, dealership_name, dealership_domain, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, await hashToken(token), email, dealershipName, dealershipDomain, expiresAt).run();
  return { id, token, email, dealershipName, dealershipDomain, expiresAt };
}

export async function getPilotInvite(token: string, env: LotSocialEnvironment) {
  await ensureLotSocialSchema(env);
  return database(env, "LotSocial accounts").prepare("SELECT * FROM pilot_invites WHERE token_hash = ? LIMIT 1")
    .bind(await hashToken(token)).first<PilotInviteRecord>();
}

export function inviteIsAvailable(invite: PilotInviteRecord | null, now = new Date()) {
  return Boolean(invite && !invite.used_at && Date.parse(invite.expires_at) > now.getTime());
}

export async function acceptPilotInvite(input: {
  token: string;
  displayName: string;
  email: string;
  phone: string;
  rooftopLocation: string;
  env: LotSocialEnvironment;
}) {
  const invite = await getPilotInvite(input.token, input.env);
  if (!inviteIsAvailable(invite)) throw new Error("This invitation is invalid, expired, or already used.");
  const email = normalizeWorkEmail(input.email);
  const displayName = input.displayName.trim();
  const phone = normalizePhone(input.phone);
  const rooftopLocation = input.rooftopLocation.trim();
  if (!email || email !== invite!.email) throw new Error("Use the work email address named in the invitation.");
  if (!displayName || !phone || !rooftopLocation) throw new Error("Name, mobile number, and dealership location are required.");

  const accountId = crypto.randomUUID();
  const rawSession = createSecureToken();
  const sessionId = crypto.randomUUID();
  const expiresAt = sessionExpiry(input.env);
  const db = database(input.env, "LotSocial accounts");
  await db.batch([
    db.prepare(`INSERT INTO associate_accounts
      (id, email, display_name, phone, dealership_name, dealership_domain, rooftop_location)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, phone = excluded.phone,
        dealership_name = excluded.dealership_name, dealership_domain = excluded.dealership_domain,
        rooftop_location = excluded.rooftop_location, status = 'active', updated_at = CURRENT_TIMESTAMP`)
      .bind(accountId, email, displayName, phone, invite!.dealership_name, invite!.dealership_domain, rooftopLocation),
    db.prepare(`INSERT INTO associate_sessions (id, account_id, token_hash, expires_at)
      VALUES (?, (SELECT id FROM associate_accounts WHERE LOWER(email) = LOWER(?) LIMIT 1), ?, ?)`)
      .bind(sessionId, email, await hashToken(rawSession), expiresAt),
    db.prepare("UPDATE pilot_invites SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL").bind(invite!.id),
  ]);
  return { rawSession, expiresAt };
}

export async function getAccountUserFromHeaders(headers: Headers, env: LotSocialEnvironment): Promise<AccountUser | null> {
  const rawToken = cookieValue(headers.get("cookie") ?? "", SESSION_COOKIE);
  if (!rawToken || !env.DB) return null;
  await ensureLotSocialSchema(env);
  const record = await database(env, "LotSocial accounts").prepare(`SELECT a.* FROM associate_sessions s
      JOIN associate_accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.status = 'active' LIMIT 1`)
    .bind(await hashToken(rawToken), new Date().toISOString()).first<AssociateAccountRecord>();
  if (!record) return null;
  return {
    accountId: record.id,
    displayName: record.display_name,
    email: record.email,
    fullName: record.display_name,
    phone: record.phone,
    dealershipName: record.dealership_name,
    dealershipDomain: record.dealership_domain,
    rooftopLocation: record.rooftop_location,
    profilePhotoUrl: record.profile_photo_url,
    role: record.role,
  };
}

export async function createAccountLoginLink(emailValue: string, env: LotSocialEnvironment) {
  const email = normalizeWorkEmail(emailValue);
  if (!email) return null;
  await ensureLotSocialSchema(env);
  const account = await database(env, "LotSocial accounts").prepare("SELECT * FROM associate_accounts WHERE LOWER(email) = LOWER(?) AND status = 'active' LIMIT 1")
    .bind(email).first<AssociateAccountRecord>();
  if (!account) return null;
  const token = createSecureToken();
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  await database(env, "LotSocial accounts").prepare(`INSERT INTO account_login_links
      (id, account_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), account.id, await hashToken(token), expiresAt).run();
  return { token, email: account.email, displayName: account.display_name, expiresAt };
}

export async function consumeAccountLoginLink(token: string, env: LotSocialEnvironment) {
  await ensureLotSocialSchema(env);
  const db = database(env, "LotSocial accounts");
  const link = await db.prepare(`SELECT l.id, l.account_id FROM account_login_links l
      JOIN associate_accounts a ON a.id = l.account_id
      WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ? AND a.status = 'active' LIMIT 1`)
    .bind(await hashToken(token), new Date().toISOString()).first<{ id: string; account_id: string }>();
  if (!link) return null;
  const rawSession = createSecureToken();
  const expiresAt = sessionExpiry(env);
  await db.batch([
    db.prepare("UPDATE account_login_links SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL").bind(link.id),
    db.prepare("INSERT INTO associate_sessions (id, account_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), link.account_id, await hashToken(rawSession), expiresAt),
  ]);
  return { rawSession, expiresAt };
}

export async function revokeAccountSession(headers: Headers, env: LotSocialEnvironment) {
  const rawToken = cookieValue(headers.get("cookie") ?? "", SESSION_COOKIE);
  if (!rawToken || !env.DB) return;
  await ensureLotSocialSchema(env);
  await database(env, "LotSocial accounts").prepare("UPDATE associate_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?")
    .bind(await hashToken(rawToken)).run();
}

export async function updateAccountProfile(email: string, input: { phone?: string; profilePhotoUrl?: string }, env: LotSocialEnvironment) {
  await ensureLotSocialSchema(env);
  const phone = input.phone === undefined ? undefined : normalizePhone(input.phone);
  if (input.phone !== undefined && !phone) throw new Error("Enter a valid mobile or dealership phone number.");
  const photoUrl = input.profilePhotoUrl?.trim();
  if (photoUrl && !photoUrl.startsWith("/api/profile-photos/")) throw new Error("The profile image must be a verified LotSocial upload.");
  if (phone !== undefined) {
    await database(env, "LotSocial accounts").prepare("UPDATE associate_accounts SET phone = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?)")
      .bind(phone, email).run();
  }
  if (photoUrl !== undefined) {
    await database(env, "LotSocial accounts").prepare("UPDATE associate_accounts SET profile_photo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?)")
      .bind(photoUrl, email).run();
  }
}

export function sessionCookie(rawSession: string, expiresAt: string) {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${rawSession}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function sessionExpiry(env: LotSocialEnvironment) {
  const configured = Number(env.LOTSOCIAL_SESSION_TTL_HOURS ?? "168");
  const hours = Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 720) : 168;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function cookieValue(cookieHeader: string, name: string) {
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}
