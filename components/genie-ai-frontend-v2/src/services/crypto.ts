// Backend expects passwords as `encPassword = sha256(password).hex`
// (matches gov-chat-frontend/src/services/userService.js#hashPassword).
// Web Crypto avoids the Node `crypto` polyfill the old app relied on.
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
