import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../chatgpt-auth";
import { handleVdpImportsGet, handleVdpImportsPost } from "../../lib/vdp-imports-handler.ts";

export async function GET(request: Request) {
  try {
    const associate = await requireAssociate(request, env);
    return handleVdpImportsGet(request, env, { associate });
  } catch (error) {
    return associateAuthResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const associate = await requireAssociate(request, env);
    return handleVdpImportsPost(request, env, { associate });
  } catch (error) {
    return associateAuthResponse(error);
  }
}
