export const isTokenExpired = (expiresAtMs: number, nowMs = Date.now()) => {
  return nowMs < expiresAtMs
}
