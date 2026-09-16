import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { validatePublicUrl } from "./vdp.ts";

const MAX_RENDER_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

async function boundedImageBody(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_RENDER_IMAGE_BYTES) throw new Error("That source image is too large to render.");
  if (!response.body) throw new Error("That source image was empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_RENDER_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("That source image is too large to render.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function serveRenderSourceImage(projectId: string, imageIndex: string, env: LotSocialEnvironment, headOnly = false) {
  const indexMatch = imageIndex.match(/^(\d{1,2})(?:\.jpg)?$/i);
  if (!/^[a-f0-9-]{36}$/i.test(projectId) || !indexMatch) return new Response("Not found", { status: 404 });
  const index = Number(indexMatch[1]);
  if (index < 0 || index > 9) return new Response("Not found", { status: 404 });
  await ensureLotSocialSchema(env);
  const project = await database(env, "creative project").prepare(
    "SELECT selected_images FROM creative_projects WHERE id = ? LIMIT 1",
  ).bind(projectId).first<{ selected_images: string }>();
  if (!project) return new Response("Not found", { status: 404 });
  const images = JSON.parse(project.selected_images || "[]") as string[];
  const source = images[index];
  if (!source) return new Response("Not found", { status: 404 });
  const sourceUrl = validatePublicUrl(source);
  const cacheKey = `render-sources/${projectId}/${index}`;
  const cached = await env.MEDIA?.get(cacheKey);
  if (cached) {
    return new Response(headOnly ? null : cached.body, { headers: {
      "Content-Type": cached.httpMetadata?.contentType || "application/octet-stream",
      "Content-Length": String(cached.size),
      "Cache-Control": "public, max-age=604800, immutable",
    } });
  }
  const upstream = await fetch(sourceUrl, {
    headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,*/*", "User-Agent": "Mozilla/5.0 LotSocial/1.0" },
    redirect: "follow",
  });
  const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!upstream.ok || !ALLOWED_IMAGE_TYPES.has(contentType)) return new Response("Source image unavailable", { status: 502 });
  const body = await boundedImageBody(upstream);
  await env.MEDIA?.put(cacheKey, body, { httpMetadata: { contentType, cacheControl: "public, max-age=604800, immutable" } });
  return new Response(headOnly ? null : body, { headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength), "Cache-Control": "public, max-age=604800, immutable" } });
}
