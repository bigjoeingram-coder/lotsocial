import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../../../chatgpt-auth";
import { handleCreativeRenderGet, handleCreativeRenderPost } from "../../../../lib/creative-render-handler.ts";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const associate = await requireAssociate(_request, env);
    return handleCreativeRenderPost(_request, env, context, { associate });
  } catch (error) {
    return associateAuthResponse(error);
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const associate = await requireAssociate(_request, env);
    return handleCreativeRenderGet(_request, env, context, { associate });
  } catch (error) {
    return associateAuthResponse(error);
  }
}
