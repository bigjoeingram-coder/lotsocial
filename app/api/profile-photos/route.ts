import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../chatgpt-auth";
import { profilePhotoExtension, verifyProfilePhotoForSocial } from "../../lib/image-moderation";
import { storeProfilePhoto } from "../../lib/media";

function arrayBufferToDataUrl(buffer: ArrayBuffer, contentType: string) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return `data:${contentType};base64,${btoa(binary)}`;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireAssociate(request, env);
  } catch (error) {
    return associateAuthResponse(error);
  }

  const form = await request.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) return Response.json({ error: "Upload one profile photo." }, { status: 400 });

  const body = await file.arrayBuffer();
  const dataUrl = arrayBufferToDataUrl(body, file.type);
  const verification = await verifyProfilePhotoForSocial(file, dataUrl, env);
  if (!verification.approved) return Response.json({ error: verification.error }, { status: verification.error.includes("not connected") ? 503 : 400 });

  const photoId = `${crypto.randomUUID()}.${profilePhotoExtension(file.type)}`;
  await storeProfilePhoto({ associateEmail: user.email, photoId, body, contentType: file.type }, env);
  const url = new URL(request.url);
  return Response.json({ photoUrl: `${url.origin}/api/profile-photos/${photoId}`, status: verification.verification ?? "validated" }, { status: 201 });
}
