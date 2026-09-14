import { env } from "cloudflare:workers";
import { consumeAccountLoginLink, sessionCookie } from "../../lib/account-auth.ts";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const session = await consumeAccountLoginLink(token, env);
  if (!session) return Response.redirect(new URL("/login?error=invalid_link", request.url), 303);
  return new Response(null, { status: 303, headers: { Location: new URL("/", request.url).toString(), "Set-Cookie": sessionCookie(session.rawSession, session.expiresAt) } });
}
