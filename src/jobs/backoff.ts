export type BackoffPolicy = {
  baseDelayMs: number;
  maxDelayMs: number;
};

export const defaultBackoffPolicy: BackoffPolicy = {
  baseDelayMs: 30_000,
  maxDelayMs: 15 * 60_000
};

export function nextRetryRunAfter(now: Date, attempts: number, policy: BackoffPolicy = defaultBackoffPolicy): Date {
  const exponent = Math.max(0, attempts - 1);
  const delayMs = Math.min(policy.baseDelayMs * 2 ** exponent, policy.maxDelayMs);
  return new Date(now.getTime() + delayMs);
}
