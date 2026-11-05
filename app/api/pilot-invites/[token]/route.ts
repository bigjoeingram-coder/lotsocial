import { env } from "cloudflare:workers";
import { beginPilotInvite, beginSharedJoin, getPilotInvite, getSharedJoinAvailability, inviteIsAvailable, isSharedJoinToken } from "../../../lib/account-auth.ts";
import { sendAccountAccessEmail } from "../../../lib/account-email.ts";
import { incrementDailyLimit, rateLimitResponse } from "../../../lib/limits.ts";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (isSharedJoinToken(token, env)) {
    try {
      const shared = await getSharedJoinAvailability(token, env);
      if (!shared.available) return Response.json({ error: "This private signup link is expired or full." }, { status: 404 });
      return Response.json({ invite: { mode: "shared", expiresAt: shared.expiresAt } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "This private signup link is unavailable." }, { status: 503 });
    }
  }
  const invite = await getPilotInvite(token, env);
  if (!inviteIsAvailable(invite)) return Response.json({ error: "This invitation is invalid, expired, or already used." }, { status: 404 });
  return Response.json({ invite: { mode: "single", email: invite!.email, dealershipName: invite!.dealership_name, dealershipDomain: invite!.dealership_domain, expiresAt: invite!.expires_at } });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = await request.json() as { displayName?: string; email?: string; phone?: string; dealershipName?: string; dealershipDomain?: string; rooftopLocation?: string };
  try {
    const shared = isSharedJoinToken(token, env);
    if (shared) {
      const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const limit = await incrementDailyLimit(env, "public_signups", ip);
      if (!limit.allowed) return rateLimitResponse(limit, "Daily private-link signup limit reached.");
    }
    const access = shared ? await beginSharedJoin({
      token,
      displayName: body.displayName ?? "",
      email: body.email ?? "",
      phone: body.phone ?? "",
      dealershipName: body.dealershipName ?? "",
      dealershipDomain: body.dealershipDomain ?? "",
      rooftopLocation: body.rooftopLocation ?? "",
      env,
    }) : await beginPilotInvite({
      token,
      displayName: body.displayName ?? "",
      email: body.email ?? "",
      phone: body.phone ?? "",
      rooftopLocation: body.rooftopLocation ?? "",
      env,
    });
    const sent = await sendAccountAccessEmail(access, env);
    if (!sent) return Response.json({ error: "LotSocial could not send the secure email. Try again." }, { status: 503 });
    return Response.json({ message: "Check your work email for a secure link to continue." }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to prepare secure account access." }, { status: 400 });
  }
}
