import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../chatgpt-auth";
import {
  handleAuthorizationRequestsGet,
  handleAuthorizationRequestsPost,
} from "../../lib/authorization-requests-handler.ts";

export async function GET(request: Request) {
  try {
    const associate = await requireAssociate(request, env);
    return handleAuthorizationRequestsGet(request, env, { associate });
  } catch (error) {
    return associateAuthResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const associate = await requireAssociate(request, env);
    return handleAuthorizationRequestsPost(request, env, { associate });
  } catch (error) {
    return associateAuthResponse(error);
  }
}
