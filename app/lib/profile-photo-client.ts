const PROFILE_PHOTO_UPLOAD_BYTES = 850 * 1024;
const PROFILE_PHOTO_MAX_DIMENSION = 1400;
const PROFILE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

async function imageSource(file: File) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap as CanvasImageSource, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Safari's image element decoder can handle some iPhone formats that createImageBitmap cannot.
    }
  }
  return new Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This browser could not read that photo. On iPhone, choose a JPEG/PNG or export the HEIC photo as Most Compatible.")); };
    image.src = url;
  });
}

function jpegBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("LotSocial could not prepare that photo.")), "image/jpeg", quality));
}

export async function prepareProfilePhoto(file: File) {
  if (!PROFILE_PHOTO_TYPES.has(file.type.toLowerCase()) && !/\.(?:jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new Error("Choose a JPEG, PNG, WebP, or HEIC profile photo.");
  }
  const decoded = await imageSource(file);
  try {
    const scale = Math.min(1, PROFILE_PHOTO_MAX_DIMENSION / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("LotSocial could not prepare that photo.");
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    let quality = 0.86;
    let blob = await jpegBlob(canvas, quality);
    while (blob.size > PROFILE_PHOTO_UPLOAD_BYTES && quality > 0.5) {
      quality -= 0.08;
      blob = await jpegBlob(canvas, quality);
    }
    if (blob.size > PROFILE_PHOTO_UPLOAD_BYTES) throw new Error("That photo is still too large after resizing. Choose a smaller image.");
    return new File([blob], "lotsocial-profile.jpg", { type: "image/jpeg" });
  } finally {
    decoded.close();
  }
}

export async function readPhotoUploadResponse(response: Response) {
  const text = await response.text();
  if (response.status === 413) return { error: "That photo was too large to upload. LotSocial resizes phone photos first; choose a smaller image if this repeats." };
  try {
    return JSON.parse(text) as { photoUrl?: string; error?: string };
  } catch {
    return { error: response.ok ? "LotSocial received an invalid photo response." : `Photo upload failed (${response.status}). Try a JPEG or PNG.` };
  }
}
