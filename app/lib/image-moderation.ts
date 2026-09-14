import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

type ModerationEnvironment = { OPENAI_API_KEY?: string; IMAGE_MODERATION_API_KEY?: string };

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PROFILE_PHOTO_BYTES = 1024 * 1024;

function moderationApiKey(env: LotSocialEnvironment) {
  const runtime = env as ModerationEnvironment;
  return (runtime.IMAGE_MODERATION_API_KEY || runtime.OPENAI_API_KEY || "").trim();
}

export function moderationIsConfigured(env: LotSocialEnvironment) {
  return Boolean(moderationApiKey(env));
}

export function validateProfilePhotoFile(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) return "Use a JPEG, PNG, or WebP profile photo.";
  if (file.size <= 0) return "That image file is empty.";
  if (file.size > MAX_PROFILE_PHOTO_BYTES) return "Use a profile photo under 1 MB. LotSocial normally resizes phone photos before upload.";
  return "";
}

export function profilePhotoExtension(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

export async function verifyProfilePhotoForSocial(file: File, dataUrl: string, env: LotSocialEnvironment) {
  const localError = validateProfilePhotoFile(file);
  if (localError) return { approved: false, error: localError };

  const apiKey = moderationApiKey(env);
  if (!apiKey) {
    return { approved: true, error: "", verification: "file_validation" };
  }

  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "omni-moderation-latest",
      input: [{ type: "image_url", image_url: { url: dataUrl } }],
    }),
  });
  const payload = await response.json() as { results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }>; error?: { message?: string } };
  if (!response.ok) {
    return { approved: false, error: payload.error?.message ?? "Photo verification could not be completed." };
  }
  const result = payload.results?.[0];
  if (result?.flagged) return { approved: false, error: "That photo was blocked by the social-safety check. Upload a different profile photo." };
  return { approved: true, error: "", verification: "moderation" };
}
