export class ProviderRequestError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(`Provider request failed: ${code}.`);
    this.name = "ProviderRequestError";
  }
}


export class ProviderResponseError extends ProviderRequestError {
  constructor(
    code: "RESPONSE_NON_JSON" | "RESPONSE_JSON_INVALID",
    readonly metadata: { endpoint: "openrouter_chat_completions"; statusClass: "2xx"; contentType: "json" | "html" | "text" | "other" | "missing"; byteLength: number }
  ) {
    super(code, false);
    this.name = "ProviderResponseError";
  }
}

export const defaultProviderRequestTimeoutMs = 60_000;

export async function fetchWithProviderTimeout(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  timeoutMs: number = defaultProviderRequestTimeoutMs
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderRequestError("TIMEOUT", true);
    throw error;
  } finally {
    clearTimeout(timeout);
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
