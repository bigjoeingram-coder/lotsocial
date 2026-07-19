import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  PERMISSIONS,
  PermissionId,
  createAuthorizationRequest,
  createSecureToken,
  hashToken,
  listAuthorizationRequests,
  setEmailDelivery,
} from "../../lib/authorization";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validPermissions(value: unknown): PermissionId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PermissionId =>
    typeof item === "string" && PERMISSIONS.some((permission) => permission.id === item));
}

function emailText(input: {
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

async function deliverEmail(input: {
  to: string;
  managerName: string;
  associateName: string;
  dealershipName: string;
  approvalUrl: string;
}) {
  const runtime = env as typeof env & {
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
  };
  if (!runtime.RESEND_API_KEY || !runtime.EMAIL_FROM) {
    return { status: "preview_ready", messageId: undefined };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: runtime.EMAIL_FROM,
      to: [input.to],
      subject: `Authorization requested for ${input.dealershipName}'s LotSocial inventory connection`,
      text: emailText(input),
    }),
  });
  if (!response.ok) return { status: "delivery_failed", messageId: undefined };
  const payload = (await response.json()) as { id?: string };
  return { status: "sent", messageId: payload.id };
}

export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });
    const requests = await listAuthorizationRequests();
    return Response.json({ requests });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load requests" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });
    const payload = (await request.json()) as Record<string, unknown>;
    const input = {
      dealershipName: clean(payload.dealershipName),
      rooftopLocation: clean(payload.rooftopLocation),
      dealershipDomain: clean(payload.dealershipDomain),
      associateName: user.fullName ?? (clean(payload.associateName) || user.displayName),
      associateEmail: user.email.toLowerCase(),
      managerName: clean(payload.managerName),
      managerTitle: clean(payload.managerTitle),
      managerEmail: clean(payload.managerEmail).toLowerCase(),
      managerPhone: clean(payload.managerPhone),
      providerName: clean(payload.providerName) || "Unknown",
      providerContactName: clean(payload.providerContactName),
      providerContactEmail: clean(payload.providerContactEmail).toLowerCase(),
      requestedPermissions: validPermissions(payload.requestedPermissions),
    };

    if (!input.dealershipName || !input.rooftopLocation || !input.associateName ||
        !input.managerName || !input.managerTitle || !emailPattern.test(input.associateEmail) ||
        !emailPattern.test(input.managerEmail) || input.requestedPermissions.length === 0) {
      return Response.json({ error: "Please complete the required dealership, associate, manager, and permission fields." }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const token = createSecureToken();
    await createAuthorizationRequest({ id, tokenHash: await hashToken(token), ...input });

    const baseUrl = new URL(request.url).origin;
    const approvalUrl = `${baseUrl}/approve/${token}`;
    const delivery = await deliverEmail({
      to: input.managerEmail,
      managerName: input.managerName,
      associateName: input.associateName,
      dealershipName: input.dealershipName,
      approvalUrl,
    });
    await setEmailDelivery(id, delivery.status, delivery.messageId);

    return Response.json({
      id,
      approvalUrl,
      emailDeliveryStatus: delivery.status,
      emailPreview: delivery.status === "preview_ready" ? emailText({
        managerName: input.managerName,
        associateName: input.associateName,
        dealershipName: input.dealershipName,
        approvalUrl,
      }) : undefined,
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create the request" }, { status: 500 });
  }
}
