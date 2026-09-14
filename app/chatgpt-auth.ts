import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { LotSocialEnvironment } from "./lib/schema-bootstrap.ts";

export type ChatGPTUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AssociateAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssociateAuthError";
  }
}

export async function requireAssociate(
  source: Request | Headers,
  env: LotSocialEnvironment,
): Promise<ChatGPTUser> {
  const requestHeaders = source instanceof Request ? source.headers : source;
  const requestHost = normalizeHost(source instanceof Request
    ? new URL(source.url).hostname
    : requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "");
  const expectedHost = normalizeHost(env.LOTSOCIAL_EXPECTED_SITES_HOSTNAME ?? "");

  if (!expectedHost || requestHost !== expectedHost) {
    throw new AssociateAuthError("This request must come through the LotSocial Sites address.");
  }

  // Trusted-by-topology: OpenAI Sites currently provides only plaintext
  // oai-authenticated-user-* headers and no signed/verifiable provenance signal.
  // This host check is only as strong as the platform's refusal to route a forged
  // Host to this worker; it is defence-in-depth, not proof of origin, and does
  // not replace the still-absent signed provenance signal.
  // When the platform ships one, replace this direct header read with that
  // verification on this line.
  const email = requestHeaders.get(USER_EMAIL_HEADER)?.trim().toLowerCase() ?? "";
  if (!EMAIL_PATTERN.test(email)) {
    throw new AssociateAuthError("Associate sign-in is required.");
  }

  const allowlist = associateAllowlist(env);
  if (!allowlist.has(email)) {
    throw new AssociateAuthError("This associate is not approved for LotSocial access.");
  }

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

export function associateAuthResponse(error: unknown) {
  if (error instanceof AssociateAuthError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  throw error;
}

export async function requireChatGPTUser(
  returnTo: string,
  env: LotSocialEnvironment,
): Promise<ChatGPTUser> {
  try {
    return await requireAssociate(await headers(), env);
  } catch (error) {
    if (error instanceof AssociateAuthError) {
      console.warn("associate_auth_rejected", { reason: error.message });
      redirect(chatGPTSignInPath(returnTo));
    }
    throw error;
  }
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function associateAllowlist(env: LotSocialEnvironment) {
  const entries = splitCsv(env.LOTSOCIAL_ASSOCIATE_ALLOWLIST ?? "")
    .map((email) => email.toLowerCase())
    .filter((email) => EMAIL_PATTERN.test(email));
  if (entries.length === 0) {
    throw new AssociateAuthError("LotSocial associate access is not configured.");
  }
  return new Set(entries);
}

function splitCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeHost(value: string) {
  return value.trim().toLowerCase().replace(/:\d+$/, "");
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
