// Pulls a user-displayable message off an axios-shaped error, falling back
// through the chain: server-supplied `message` → JS Error.message → caller's
// fallback string. Centralised so call sites don't repeat the cast dance.
export function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}
