export function replenishSelectedImages(
  selectedImages: string[],
  availableImages: string[],
  brokenImages: Iterable<string>,
  maximum = 10,
) {
  const broken = new Set(brokenImages);
  const next = selectedImages.filter((image) => !broken.has(image));

  for (const candidate of availableImages) {
    if (next.length >= maximum) break;
    if (!broken.has(candidate) && !next.includes(candidate)) next.push(candidate);
  }

  return next;
}
