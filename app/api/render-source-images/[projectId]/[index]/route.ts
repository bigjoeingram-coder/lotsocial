import { env } from "cloudflare:workers";
import { serveRenderSourceImage } from "../../../../lib/render-source.ts";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string; index: string }> }) {
  const { projectId, index } = await context.params;
  return serveRenderSourceImage(projectId, index, env);
}

export async function HEAD(_request: Request, context: { params: Promise<{ projectId: string; index: string }> }) {
  const { projectId, index } = await context.params;
  return serveRenderSourceImage(projectId, index, env, true);
}
