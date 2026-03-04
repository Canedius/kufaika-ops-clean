export function getPhotoUrl(sku: string): string | null {
  if (!sku) return null;
  // All SKUs follow KUF### (6 chars) + COLOR_CODE (2 chars) + size
  const norm = sku.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
  const base = norm.slice(0, 8);
  if (base.length < 8) return null;
  return `/photos/${base}.webp`;
}
