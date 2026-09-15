import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

type MediaEnvironment = { MEDIA?: R2Bucket };

function mediaBucket(env: LotSocialEnvironment) {
  const bucket = (env as MediaEnvironment).MEDIA;
  if (!bucket) throw new Error("Permanent video storage is unavailable.");
  return bucket;
}

export async function archiveRenderedVideo(jobId: string, associateEmail: string, providerUrl: string, env: LotSocialEnvironment) {
  const response = await fetch(providerUrl);
  if (!response.ok || !response.body) throw new Error("The completed video could not be copied into permanent storage.");
  const safeOwner = associateEmail.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "associate";
  const key = `renders/${safeOwner}/${jobId}.mp4`;
  await mediaBucket(env).put(key, response.body, {
    httpMetadata: { contentType: response.headers.get("content-type") || "video/mp4", cacheControl: "private, max-age=3600" },
    customMetadata: { jobId, associateEmail },
  });
  return { storageKey: key, outputUrl: `/api/rendered-videos/${jobId}` };
}

export async function getStoredVideo(storageKey: string, env: LotSocialEnvironment) {
  return mediaBucket(env).get(storageKey);
}

export async function storeProfilePhoto(input: {
  associateEmail: string;
  photoId: string;
  body: ArrayBuffer;
  contentType: string;
}, env: LotSocialEnvironment) {
  const safeOwner = input.associateEmail.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "associate";
  const key = `profile-photos/${input.photoId}`;
  await mediaBucket(env).put(key, input.body, {
    httpMetadata: { contentType: input.contentType, cacheControl: "public, max-age=86400" },
    customMetadata: { associateEmail: input.associateEmail, owner: safeOwner, photoId: input.photoId },
  });
  return { storageKey: key };
}

export async function getStoredProfilePhoto(photoId: string, env: LotSocialEnvironment) {
  if (!/^[a-f0-9-]{36}\.(?:jpg|jpeg|png|webp)$/i.test(photoId)) return null;
  return mediaBucket(env).get(`profile-photos/${photoId}`);
}

function profilePhotoId(photoUrl: string) {
  try {
    const pathname = new URL(photoUrl, "https://lotsocial.invalid").pathname;
    return pathname.match(/^\/api\/profile-photos\/([a-f0-9-]{36}\.(?:jpg|jpeg|png|webp))$/i)?.[1] ?? "";
  } catch {
    return "";
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function getProfilePhotoDataUri(photoUrl: string, env: LotSocialEnvironment) {
  const photoId = profilePhotoId(photoUrl);
  if (!photoId) return "";
  const object = await getStoredProfilePhoto(photoId, env);
  if (!object) return "";
  const contentType = object.httpMetadata?.contentType || "image/jpeg";
  return `data:${contentType};base64,${arrayBufferToBase64(await object.arrayBuffer())}`;
}
