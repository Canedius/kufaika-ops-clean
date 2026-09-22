/**
 * Єдина нормалізація розмірів для матриці виробництва та експорту.
 *
 * Розміри приходять з трьох джерел: каталог (XL/XXL), DataTable n8n і
 * ручне введення для виробів поза каталогом (KUF000) — там оператор пише
 * що завгодно: «XL-2XL», «xl / xxl», «під замір». Без нормалізації такі
 * позиції не потрапляли в жодну колонку і зникали з аналізу.
 */

/** Стандартні колонки матриці — у порядку зростання розміру. */
export const SIZE_COLUMNS = ["XS", "XS/S", "S", "M", "M/L", "L", "XL", "XL/2XL", "2XL", "3XL"] as const;

/** Колонка для позицій, де розмір взагалі не вказано. */
export const NO_SIZE_COLUMN = "б/р";

const STANDARD = new Set<string>(SIZE_COLUMNS);

/** XXL і подібні записи розміру — до канонічного вигляду. */
const TOKEN_ALIAS: Record<string, string> = {
  XXS: "2XS",
  XXL: "2XL",
  XXXL: "3XL",
  XXXXL: "4XL",
};

/** Токен, що справді є розміром: XS, 2XL, 3XL, 48 тощо. */
const SIZE_TOKEN = /^(\d*X*(?:S|M|L)|\d+)$/;

/**
 * «XL-2XL», «xl / xxl», «XL\XXL» → «XL/2XL».
 * Довільний текст («під замір») лишається текстом — з великої літери, щоб
 * різний регістр не дав двох колонок; такий розмір отримає власну колонку,
 * а не зникне з таблиці.
 */
export function normalizeSize(raw?: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const unified = trimmed
    .toUpperCase()
    .replace(/\s*[-–—/\\|]\s*/g, "/")
    .replace(/\s+/g, " ");
  const parts = unified.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 0 && parts.every((p) => SIZE_TOKEN.test(TOKEN_ALIAS[p] || p))) {
    return parts.map((p) => TOKEN_ALIAS[p] || p).join("/");
  }
  const lower = trimmed.toLocaleLowerCase("uk");
  return lower.charAt(0).toLocaleUpperCase("uk") + lower.slice(1);
}

export function isStandardSize(size: string): boolean {
  return STANDARD.has(size);
}

/**
 * Колонки для таблиці: стандартні + фактичні нестандартні («4XL», «під замір»),
 * які трапились у даних. Вхід — уже нормалізовані значення.
 */
export function sizeColumnsFrom(normalized: Iterable<string>): string[] {
  const extras = new Set<string>();
  for (const s of normalized) {
    if (s && !STANDARD.has(s)) extras.add(s);
  }
  return [...SIZE_COLUMNS, ...[...extras].sort((a, b) => a.localeCompare(b, "uk"))];
}
