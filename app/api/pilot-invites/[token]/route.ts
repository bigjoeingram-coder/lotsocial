import { env } from "cloudflare:workers";
import { acceptPilotInvite, getPilotInvite, inviteIsAvailable, sessionCookie } from "../../../lib/account-auth.ts";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const invite = await getPilotInvite(token, env);
  if (!inviteIsAvailable(invite)) return Response.json({ error: "This invitation is invalid, expired, or already used." }, { status: 404 });
  return Response.json({ invite: { email: invite!.email, dealershipName: invite!.dealership_name, dealershipDomain: invite!.dealership_domain, expiresAt: invite!.expires_at } });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = await request.json() as { displayName?: string; email?: string; phone?: string; rooftopLocation?: string };
  try {
    const session = await acceptPilotInvite({
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
