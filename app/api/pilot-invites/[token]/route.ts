import { env } from "cloudflare:workers";
import { acceptPilotInvite, acceptSharedJoin, getPilotInvite, getSharedJoinAvailability, inviteIsAvailable, isSharedJoinToken, sessionCookie } from "../../../lib/account-auth.ts";
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
    const session = shared ? await acceptSharedJoin({
      token,
      displayName: body.displayName ?? "",
      email: body.email ?? "",
      phone: body.phone ?? "",
      dealershipName: body.dealershipName ?? "",
      dealershipDomain: body.dealershipDomain ?? "",
      rooftopLocation: body.rooftopLocation ?? "",
      env,
    }) : await acceptPilotInvite({
      token,
      displayName: body.displayName ?? "",
      email: body.email ?? "",
      phone: body.phone ?? "",
      rooftopLocation: body.rooftopLocation ?? "",
      env,
    });
    return Response.json({ ok: true, redirectTo: "/" }, { status: 201, headers: { "Set-Cookie": sessionCookie(session.rawSession, session.expiresAt) } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create the account." }, { status: 400 });
  }
}
