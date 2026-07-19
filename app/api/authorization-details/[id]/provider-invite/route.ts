import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { addAuditEvent, createProviderVerificationInvite, createSecureToken, getAuthorizationByIdForAssociate, hashToken } from "../../../../lib/authorization";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function providerEmailText(input: { contactName: string; dealershipName: string; providerUrl: string }) {
  return `Hello ${input.contactName},

${input.dealershipName} has identified your company as its inventory-data provider for LotSocial.

Please confirm the data rights and supported delivery method using this secure link:

${input.providerUrl}

This confirmation does not share credentials or activate a connection. LotSocial will complete a separate technical verification before inventory use begins.

LotSocial Inventory Operations`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });
  const { id } = await context.params;
  const record = await getAuthorizationByIdForAssociate(id, user.email);
  if (!record) return Response.json({ error: "Authorization record not found." }, { status: 404 });
  if (!["manager_approved", "provider_pending", "provider_declined"].includes(record.status)) {
    return Response.json({ error: "Provider verification can only begin after manager approval." }, { status: 409 });
  }

  const payload = (await request.json()) as Record<string, unknown>;
  const providerName = clean(payload.providerName);
  const contactName = clean(payload.contactName);
  const contactEmail = clean(payload.contactEmail).toLowerCase();
  if (!providerName || !contactName || !emailPattern.test(contactEmail)) {
    return Response.json({ error: "Provider company, contact name, and a valid email are required." }, { status: 400 });
  }

  const token = createSecureToken();
  await createProviderVerificationInvite({ record, tokenHash: await hashToken(token), providerName, contactName, contactEmail });
  const providerUrl = `${new URL(request.url).origin}/provider/${token}`;
  const runtime = env as typeof env & { RESEND_API_KEY?: string; EMAIL_FROM?: string };
  let emailDeliveryStatus = "preview_ready";
  if (runtime.RESEND_API_KEY && runtime.EMAIL_FROM) {
    const delivery = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: runtime.EMAIL_FROM,
        to: [contactEmail],
        subject: `Confirm inventory feed rights for ${record.dealership_name}`,
        text: providerEmailText({ contactName, dealershipName: record.dealership_name, providerUrl }),
      }),
    });
    emailDeliveryStatus = delivery.ok ? "sent" : "delivery_failed";
  }
  await addAuditEvent(record.id, "system", "", "provider_invitation_prepared", { contactEmail, emailDeliveryStatus });

  return Response.json({
    providerUrl,
    emailDeliveryStatus,
    emailPreview: emailDeliveryStatus === "preview_ready" ? providerEmailText({ contactName, dealershipName: record.dealership_name, providerUrl }) : undefined,
  });
}
