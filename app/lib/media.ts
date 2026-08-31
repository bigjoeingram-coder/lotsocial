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
