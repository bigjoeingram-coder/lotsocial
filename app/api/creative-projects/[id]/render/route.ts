import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { handleCreativeRenderGet, handleCreativeRenderPost } from "../../../../lib/creative-render-handler.ts";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCreativeRenderPost(_request, env, context, { getUser: getChatGPTUser });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCreativeRenderGet(_request, env, context, { getUser: getChatGPTUser });
}
