/**
 * Normalize a phone number to E.164 format.
 * WhatsApp sends numbers without the + prefix (e.g. "2201234567").
 * We store them with the + prefix.
 */
export function normalizePhoneNumber(phone: string): string {
  let normalized = phone.trim();

  // Remove any spaces, dashes, parentheses
  normalized = normalized.replace(/[\s\-()]/g, "");

  // Ensure + prefix
  if (!normalized.startsWith("+")) {
    normalized = `+${normalized}`;
  }

  return normalized;
}

/**
 * Strip the + prefix for WhatsApp API calls (they expect no +).
 */
export function toWhatsAppFormat(phone: string): string {
  return normalizePhoneNumber(phone).replace(/^\+/, "");
}
