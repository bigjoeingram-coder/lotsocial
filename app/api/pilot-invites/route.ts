import { env } from "cloudflare:workers";
import { createPilotInvite } from "../../lib/account-auth.ts";
import { secureEqual } from "../../lib/telemetry.ts";

export async function POST(request: Request) {
  const configuredKey = env.ENFORCEMENT_API_KEY;
  const suppliedKey = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configuredKey || !secureEqual(configuredKey, suppliedKey)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json() as { email?: string; dealershipName?: string; dealershipDomain?: string; ttlHours?: number };
  try {
    const invite = await createPilotInvite({
      email: body.email ?? "",
      dealershipName: body.dealershipName ?? "",
      dealershipDomain: body.dealershipDomain ?? "",
      ttlHours: body.ttlHours,
      env,
    });
    const joinUrl = new URL(`/join/${invite.token}`, request.url).toString();
    let emailDeliveryStatus = "not_configured";
    if (env.RESEND_API_KEY && env.EMAIL_FROM) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [invite.email],
          subject: `Your LotSocial pilot invitation for ${invite.dealershipName}`,
          text: `You have been invited to create a LotSocial pilot account for ${invite.dealershipName}.\n\nCreate your account: ${joinUrl}\n\nThis single-use link expires ${invite.expiresAt}.`,
        }),
      });
      emailDeliveryStatus = response.ok ? "sent" : "failed";
    }
    return Response.json({ invite: { email: invite.email, dealershipName: invite.dealershipName, dealershipDomain: invite.dealershipDomain, expiresAt: invite.expiresAt }, joinUrl, emailDeliveryStatus }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create the invitation." }, { status: 400 });
  }
}
