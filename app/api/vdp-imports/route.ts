import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleVdpImportsGet, handleVdpImportsPost } from "../../lib/vdp-imports-handler.ts";

export async function GET(request: Request) {
  return handleVdpImportsGet(request, env, { getUser: getChatGPTUser });
}

export async function POST(request: Request) {
  return handleVdpImportsPost(request, env, { getUser: getChatGPTUser });
}
