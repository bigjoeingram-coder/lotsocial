import { incrementDailyLimit, rateLimitResponse } from "./limits.ts";
import {
  PERMISSIONS,
  createAuthorizationRequest,
  createSecureToken,
  hashToken,
  listAuthorizationRequests,
  setEmailDelivery,
} from "./authorization.ts";
import type { PermissionId } from "./authorization.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

type RouteUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

type AuthorizationRequestInput = {
  id: string;
  token: string;
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
};

type EmailDelivery = {
  status: string;
  messageId?: string;
};

type AuthorizationRequestDependencies = {
  associate: RouteUser;
  listAuthorizationRequests?: typeof listAuthorizationRequests;
  createAuthorizationRequest?: typeof createAuthorizationRequest;
  setEmailDelivery?: typeof setEmailDelivery;
  deliverEmail?: (input: {
    to: string;
    managerName: string;
    associateName: string;
    dealershipName: string;
    approvalUrl: string;
    env: LotSocialEnvironment;
  }) => Promise<EmailDelivery>;
  createId?: () => string;
  createToken?: typeof createSecureToken;
  hashToken?: typeof hashToken;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleAuthorizationRequestsGet(
  _request: Request,
  env: LotSocialEnvironment,
  dependencies: AuthorizationRequestDependencies,
) {
  const requests = await (dependencies.listAuthorizationRequests ?? listAuthorizationRequests)(
    dependencies.associate.email,
    20,
    env,
  );
  return Response.json({ requests });
}

export async function handleAuthorizationRequestsPost(
  request: Request,
  env: LotSocialEnvironment,
  dependencies: AuthorizationRequestDependencies,
) {
  const payload = (await request.json()) as Record<string, unknown>;
  const input: AuthorizationRequestInput = {
    id: dependencies.createId?.() ?? crypto.randomUUID(),
    token: dependencies.createToken?.() ?? createSecureToken(),
    tokenHash: "",
    dealershipName: clean(payload.dealershipName),
    rooftopLocation: clean(payload.rooftopLocation),
    dealershipDomain: normalizeDomain(clean(payload.dealershipDomain)),
    associateName: dependencies.associate.fullName ?? (clean(payload.associateName) || dependencies.associate.displayName),
    associateEmail: dependencies.associate.email.toLowerCase(),
    managerName: clean(payload.managerName),
    managerTitle: clean(payload.managerTitle),
    managerEmail: clean(payload.managerEmail).toLowerCase(),
    managerPhone: clean(payload.managerPhone),
    providerName: clean(payload.providerName) || "Unknown",
    providerContactName: clean(payload.providerContactName),
    providerContactEmail: clean(payload.providerContactEmail).toLowerCase(),
    requestedPermissions: validPermissions(payload.requestedPermissions),
  };
  input.tokenHash = await (dependencies.hashToken ?? hashToken)(input.token);

  if (!input.dealershipName || !input.rooftopLocation || !input.associateName ||
      !input.managerName || !input.managerTitle || !emailPattern.test(input.associateEmail) ||
      !emailPattern.test(input.managerEmail) || input.requestedPermissions.length === 0) {
    return Response.json({ error: "Please complete the required dealership, associate, manager, and permission fields." }, { status: 400 });
  }

  if (!input.dealershipDomain || !managerEmailMatchesPolicy(input.managerEmail, input.dealershipDomain, env)) {
    return Response.json({
      error: "Manager email must match the dealership domain policy. Use a dealership-domain manager address or ask the LotSocial owner to review it.",
    }, { status: 400 });
  }

  const associateLimit = await incrementDailyLimit(env, "authorization_requests", input.associateEmail);
  if (!associateLimit.allowed) {
    return rateLimitResponse(associateLimit, "Daily authorization request limit reached for this associate.");
  }

  const managerLimit = await incrementDailyLimit(env, "manager_email", input.managerEmail);
  if (!managerLimit.allowed) {
    return rateLimitResponse(managerLimit, "Daily authorization email limit reached for this manager address.");
  }

  await (dependencies.createAuthorizationRequest ?? createAuthorizationRequest)({
    id: input.id,
    tokenHash: input.tokenHash,
    dealershipName: input.dealershipName,
    rooftopLocation: input.rooftopLocation,
    dealershipDomain: input.dealershipDomain,
    associateName: input.associateName,
    associateEmail: input.associateEmail,
    managerName: input.managerName,
    managerTitle: input.managerTitle,
    managerEmail: input.managerEmail,
    managerPhone: input.managerPhone,
    providerName: input.providerName,
    providerContactName: input.providerContactName,
    providerContactEmail: input.providerContactEmail,
    requestedPermissions: input.requestedPermissions,
    env,
  });

  const approvalUrl = `${new URL(request.url).origin}/approve/${input.token}`;
  const delivery = await (dependencies.deliverEmail ?? deliverAuthorizationEmail)({
    to: input.managerEmail,
    managerName: input.managerName,
    associateName: input.associateName,
    dealershipName: input.dealershipName,
    approvalUrl,
    env,
  });
  await (dependencies.setEmailDelivery ?? setEmailDelivery)(input.id, delivery.status, delivery.messageId, env);

  return Response.json({
    id: input.id,
    approvalUrl,
    emailDeliveryStatus: delivery.status,
    emailPreview: delivery.status === "preview_ready" ? emailText({
      managerName: input.managerName,
      associateName: input.associateName,
      dealershipName: input.dealershipName,
      approvalUrl,
    }) : undefined,
  }, { status: 201 });
}

export function emailText(input: {
  managerName: string;
  associateName: string;
  dealershipName: string;
  approvalUrl: string;
}) {
  return `Hello ${input.managerName},

${input.associateName} has requested permission to connect ${input.dealershipName}'s vehicle inventory to LotSocial.

Please review the requested data uses, identify your inventory provider, and approve or decline using this secure link:

${input.approvalUrl}

LotSocial will not activate inventory until the connection and permitted uses are confirmed. Authorization may be limited, given an expiration date, or revoked.

LotSocial Inventory Operations`;
}

export async function deliverAuthorizationEmail(input: {
  to: string;
  managerName: string;
  associateName: string;
  dealershipName: string;
  approvalUrl: string;
  env: LotSocialEnvironment;
}) {
  if (!input.env.RESEND_API_KEY || !input.env.EMAIL_FROM) {
    return { status: "preview_ready", messageId: undefined };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.env.EMAIL_FROM,
      to: [input.to],
      subject: `Authorization requested for ${input.dealershipName}'s LotSocial inventory connection`,
      text: emailText(input),
    }),
  });
  if (!response.ok) return { status: "delivery_failed", messageId: undefined };
  const payload = (await response.json()) as { id?: string };
  return { status: "sent", messageId: payload.id };
}

export function managerEmailMatchesPolicy(managerEmail: string, dealershipDomain: string, env: LotSocialEnvironment) {
  const managerDomain = managerEmail.split("@").at(1)?.toLowerCase() ?? "";
  const allowedDomains = new Set([
    dealershipDomain,
    ...splitCsv(env.LOTSOCIAL_MANAGER_EMAIL_DOMAIN_ALLOWLIST ?? "").map(normalizeDomain),
  ].filter(Boolean));
  return [...allowedDomains].some((domain) =>
    managerDomain === domain || managerDomain.endsWith(`.${domain}`));
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validPermissions(value: unknown): PermissionId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PermissionId =>
    typeof item === "string" && PERMISSIONS.some((permission) => permission.id === item));
}

function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^@/, "").replace(/^www\./, "").split("/")[0];
  }
}

function splitCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
