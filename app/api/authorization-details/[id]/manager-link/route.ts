import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../../../chatgpt-auth";
import { addAuditEvent, createSecureToken, getAuthorizationByIdForAssociate, hashToken, rotateManagementLink } from "../../../../lib/authorization";

function managerLinkEmail(input: { managerName: string; dealershipName: string; managerUrl: string; expiresAt: string }) {
  return `Hello ${input.managerName},

A fresh secure LotSocial management link is ready for ${input.dealershipName}:

${input.managerUrl}

This link expires at ${input.expiresAt}. It replaces every earlier management link.

LotSocial Inventory Operations`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireAssociate(request, env);
  } catch (error) {
    return associateAuthResponse(error);
  }
  const { id } = await context.params;
  const record = await getAuthorizationByIdForAssociate(id, user.email, env);
  if (!record) return Response.json({ error: "Authorization record not found." }, { status: 404 });
  if (!["manager_approved", "provider_pending", "provider_verified", "provider_declined", "feed_connected", "active", "suspended"].includes(record.status)) {
    return Response.json({ error: "A management link is only available for an approved authorization." }, { status: 409 });
  }

  const token = createSecureToken();
  const expiresAt = await rotateManagementLink(record.id, await hashToken(token), env);
  const managerUrl = `${new URL(request.url).origin}/approve/${token}`;
  let emailDeliveryStatus = "preview_ready";
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    const delivery = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [record.manager_email],
        subject: `Fresh LotSocial management link for ${record.dealership_name}`,
        text: managerLinkEmail({ managerName: record.manager_name, dealershipName: record.dealership_name, managerUrl, expiresAt }),
      }),
    });
    emailDeliveryStatus = delivery.ok ? "sent" : "delivery_failed";
  }
  await addAuditEvent(record.id, "associate", user.email, "management_link_rotated", { expiresAt, emailDeliveryStatus }, env);
  return Response.json({
    managerUrl,
    expiresAt,
    emailDeliveryStatus,
    emailPreview: emailDeliveryStatus === "preview_ready"
      ? managerLinkEmail({ managerName: record.manager_name, dealershipName: record.dealership_name, managerUrl, expiresAt })
      : undefined,
  });
}
