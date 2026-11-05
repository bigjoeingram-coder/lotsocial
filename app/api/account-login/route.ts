import { env } from "cloudflare:workers";
import { handleAccountLoginPost } from "../../lib/account-login-handler.ts";

export async function POST(request: Request) {
  return handleAccountLoginPost(request, env);
}
