export function getPhotoUrl(sku: string): string | null {
  if (!sku) return null;

  const norm = sku.toUpperCase().trim().replace(/[^A-Z0-9/]/g, "");

  // Очікуємо формат типу KUF001KHM -> KUF001 + KH (колір) + M (розмір)
  // Беремо лише product+color, відкидаємо розмір.
  const m = norm.match(/^([A-Z0-9]{6})([A-Z]{2})/);
  if (!m) return null;

  const base = `${m[1]}${m[2]}`; // напр. KUF001KH
  return `/photos/${base}.webp`;
}
