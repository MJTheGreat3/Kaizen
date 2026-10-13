const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** Paise to a display string, e.g. 125050 -> "₹1,250.5". */
export function formatPaise(paise: number): string {
  return rupees.format(paise / 100);
}

/**
 * Parses amounts like "250", "1,200", "1.5k", "₹ 99.50", "rs 40".
 * Returns paise, or null when the text is not an amount.
 */
export function parseRupees(input: string): number | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^(₹|rs\.?|inr)\s*/, "")
    .replace(/,/g, "");
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*(k)?$/);
  if (!match) return null;
  const value = Number(match[1]) * (match[2] ? 1000 : 1);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}
