import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../../../chatgpt-auth";
import { addAuditEvent, createSecureToken, getAuthorizationByIdForAssociate, issueManagementToken } from "../../../../lib/authorization";

function managementEmailText(input: { managerName: string; dealershipName: string; managementUrl: string; expiresAt: string }) {
  return `Hello ${input.managerName},

Your LotSocial inventory authorization for ${input.dealershipName} can be reviewed, changed, paused, or revoked from this secure management link:

${input.managementUrl}

This link expires ${input.expiresAt}. If it expires, the associate can send a fresh management link from LotSocial.

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
    return Response.json({ error: "A management link is available only after manager approval and before revocation." }, { status: 409 });
  }

  const token = createSecureToken();
  const expiresAt = await issueManagementToken({ record, token, env, actorType: "associate", actorEmail: user.email });
  const managementUrl = `${new URL(request.url).origin}/approve/${token}`;
  const runtime = env as typeof env & { RESEND_API_KEY?: string; EMAIL_FROM?: string };
  let emailDeliveryStatus = "preview_ready";
  const text = managementEmailText({ managerName: record.manager_name, dealershipName: record.dealership_name, managementUrl, expiresAt });
  if (runtime.RESEND_API_KEY && runtime.EMAIL_FROM) {
    const delivery = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: runtime.EMAIL_FROM,
        to: [record.manager_email],
        subject: `Manage LotSocial authorization for ${record.dealership_name}`,
        text,
      }),
    });
    emailDeliveryStatus = delivery.ok ? "sent" : "delivery_failed";
  }
  await addAuditEvent(record.id, "system", "", "management_link_delivery", { emailDeliveryStatus, expiresAt }, env);
  return Response.json({
    managementUrl, expiresAt, emailDeliveryStatus,
    emailPreview: emailDeliveryStatus === "preview_ready" ? text : undefined,
  });
}
