import { env } from "cloudflare:workers";
import { expiredSessionCookie, revokeAccountSession } from "../../lib/account-auth.ts";

async function logout(request: Request) {
  await revokeAccountSession(request.headers, env);
  return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": expiredSessionCookie() } });
}

export const GET = logout;
export const POST = logout;
