/**
 * Formats a number as currency
 * @param value Number to format
 * @param locale Locale to use for formatting
 * @param currency Currency code
 * @returns Formatted currency string
 */
export const formatCurrency = (value: number, locale = "en-US", currency = "USD"): string => {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

/**
 * Formats a percentage
 * @param value Number to format as percentage
 * @param locale Locale to use for formatting
 * @param digits Number of decimal places
 * @returns Formatted percentage string
 */
export const formatPercentage = (value: number, locale = "en-US", digits = 1): string => {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value / 100)
}

/** Compact large dashboard values (1.2K, 3.4M) while retaining useful decimals. */
export const formatCompactNumber = (
  value: unknown,
  maximumFractionDigits = 2,
  locale = "en-US"
): string => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return value == null ? "0" : String(value);

  const absolute = Math.abs(numeric);
  return new Intl.NumberFormat(locale, {
    notation: absolute >= 1_000 ? "compact" : "standard",
    compactDisplay: "short",
    maximumFractionDigits: absolute > 0 && absolute < 1
      ? Math.max(maximumFractionDigits, 4)
      : maximumFractionDigits,
  }).format(numeric);
}

/**
 * Title cases a string (e.g. "hello_world" -> "Hello World")
 * @param str String to transform
 * @returns Title cased string
 */
export const toTitleCase = (str: string): string => {
  return str.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
}
