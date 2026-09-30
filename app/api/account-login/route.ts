import { env } from "cloudflare:workers";
import { requestAccountLogin } from "../../lib/account-login.ts";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string };
  const result = await requestAccountLogin(body.email ?? "", env);
  return Response.json(result.body, { status: result.status });
}
