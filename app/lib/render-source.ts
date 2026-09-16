import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { validatePublicUrl } from "./vdp.ts";

const MAX_RENDER_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signedRelayUrl(source: URL, env: LotSocialEnvironment) {
  const origin = env.LOTSOCIAL_RENDER_PROXY_ORIGIN?.trim().replace(/\/$/, "");
  const secret = env.LOTSOCIAL_RENDER_PROXY_SECRET?.trim();
  if (!origin || !secret) return "";
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 2;
  const encoded = base64Url(new TextEncoder().encode(source.href));
  const message = `${expires}.${encoded}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))));
  return `${origin}/image.jpg?e=${expires}&u=${encoded}&s=${signature}`;
}

function imageContentType(response: Response) {
  return (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
}

function isUsableImage(response: Response) {
  return response.ok && ALLOWED_IMAGE_TYPES.has(imageContentType(response));
}

async function fetchSourceImage(source: URL, env: LotSocialEnvironment) {
  const options = {
    headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,*/*", "User-Agent": "Mozilla/5.0 LotSocial/1.0" },
    redirect: "follow" as const,
  };
  const direct = await fetch(source, options);
  if (isUsableImage(direct)) return direct;
  await direct.body?.cancel();
  const relay = await signedRelayUrl(source, env);
  return relay ? fetch(relay, options) : direct;
}

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
  const upstream = await fetchSourceImage(sourceUrl, env);
  const contentType = imageContentType(upstream);
  if (!isUsableImage(upstream)) {
    await upstream.body?.cancel();
    return new Response("Source image unavailable", { status: 502 });
  }
  const body = await boundedImageBody(upstream);
  await env.MEDIA?.put(cacheKey, body, { httpMetadata: { contentType, cacheControl: "public, max-age=604800, immutable" } });
  return new Response(headOnly ? null : body, { headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength), "Cache-Control": "public, max-age=604800, immutable" } });
}
