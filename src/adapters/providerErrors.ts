export class ProviderRequestError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(`Provider request failed: ${code}.`);
    this.name = "ProviderRequestError";
  }
}

export function providerHttpError(status: number): ProviderRequestError {
  return new ProviderRequestError(`HTTP_${status}`, status === 408 || status === 429 || status >= 500);
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderRequestError) return error.retryable;
  const status = readStatus(error);
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  return error instanceof TypeError;
}

export function safeProviderErrorCode(error: unknown): string {
  if (error instanceof ProviderRequestError) return error.code;
  const status = readStatus(error);
  if (status !== undefined) return `HTTP_${status}`;
  if (error instanceof TypeError) return "NETWORK_ERROR";
  return "PROVIDER_REQUEST_FAILED";
}

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
