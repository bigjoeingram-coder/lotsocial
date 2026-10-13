// The revision hash covers every field that changes what gets published.
// Approval is bound to this hash, and the dispatcher re-checks it at send time.
export type PublishFields = {
  platform: string;
  destinationId: string;
  caption: string;
  title: string;
  description: string;
  platformOptions: string;
  mediaStorageKey: string;
  // Checksum or version of the file itself, so a different file at the same key voids approval.
  mediaChecksum: string;
};

export async function revisionHash(fields: PublishFields): Promise<string> {
  const canonical = JSON.stringify([
    fields.platform, fields.destinationId, fields.caption, fields.title,
    fields.description, canonicalJson(fields.platformOptions), fields.mediaStorageKey, fields.mediaChecksum,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(raw: string): string {
  try {
    return JSON.stringify(sortKeys(JSON.parse(raw || "{}")));
  } catch {
    return raw;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
  }
  return value;
}
