const recoveryTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function isValidRecoveryToken(token: string): boolean {
  return recoveryTokenPattern.test(token);
}

export function createRecoveryLink(token: string, origin = window.location.origin): string {
  if (!isValidRecoveryToken(token)) throw new Error("Invalid recovery link.");
  // A fragment keeps the secret out of hosting requests and referrer headers.
  return `${origin}/#password-recovery=${token}`;
}
