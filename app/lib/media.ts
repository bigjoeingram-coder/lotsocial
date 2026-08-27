import { env } from "cloudflare:workers";

type MediaEnvironment = { MEDIA?: R2Bucket };

function mediaBucket() {
  const bucket = (env as unknown as MediaEnvironment).MEDIA;
  if (!bucket) throw new Error("Permanent video storage is unavailable.");
  return bucket;
}

export async function archiveRenderedVideo(jobId: string, associateEmail: string, providerUrl: string) {
  const response = await fetch(providerUrl);
  if (!response.ok || !response.body) throw new Error("The completed video could not be copied into permanent storage.");
  const safeOwner = associateEmail.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "associate";
  const key = `renders/${safeOwner}/${jobId}.mp4`;
  await mediaBucket().put(key, response.body, {
    httpMetadata: { contentType: response.headers.get("content-type") || "video/mp4", cacheControl: "private, max-age=3600" },
    customMetadata: { jobId, associateEmail },
  });
  return { storageKey: key, outputUrl: `/api/rendered-videos/${jobId}` };
}

export async function getStoredVideo(storageKey: string) {
  return mediaBucket().get(storageKey);
}

export async function storeProfilePhoto(input: {
  associateEmail: string;
  photoId: string;
  body: ArrayBuffer;
  contentType: string;
}) {
  const safeOwner = input.associateEmail.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "associate";
  const key = `profile-photos/${input.photoId}`;
  await mediaBucket().put(key, input.body, {
    httpMetadata: { contentType: input.contentType, cacheControl: "public, max-age=86400" },
    customMetadata: { associateEmail: input.associateEmail, owner: safeOwner, photoId: input.photoId },
  });
  return { storageKey: key };
}

export async function getStoredProfilePhoto(photoId: string) {
  if (!/^[a-f0-9-]{36}\.(?:jpg|jpeg|png|webp)$/i.test(photoId)) return null;
  return mediaBucket().get(`profile-photos/${photoId}`);
}
