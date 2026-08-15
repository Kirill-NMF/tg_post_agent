import { defaultProviderRequestTimeoutMs, fetchWithProviderTimeout, ProviderResponseError, providerHttpError } from "./providerErrors.js";

export type OpenRouterInteractionRequest = {
  model: string;
  input: string;
  response_format: {
    type: "text";
    mime_type: "application/json";
    schema: Record<string, unknown>;
  };
};

export type OpenRouterInteractionClient = {
  create(request: OpenRouterInteractionRequest): Promise<{ output_text?: unknown }>;
};

export function createOpenRouterInteractionClient(input: { apiKey: string; fetchImpl?: typeof fetch; requestTimeoutMs?: number; providerRoute?: { order: string[]; allow_fallbacks: false } }): OpenRouterInteractionClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    async create(request) {
      const response = await fetchWithProviderTimeout(fetchImpl, "https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          stream: false,
          messages: [
            {
              role: "system",
              content: `Return exactly one JSON object that conforms to this JSON Schema: ${JSON.stringify(request.response_format.schema)}`
            },
            { role: "user", content: request.input }
          ],
          response_format: { type: "json_object" },
          ...(input.providerRoute ? { provider: input.providerRoute } : {})
        })
      }, input.requestTimeoutMs ?? defaultProviderRequestTimeoutMs);
      if (!response.ok) throw providerHttpError(response.status);
      const raw = await response.text();
      const metadata = {
        endpoint: "openrouter_chat_completions" as const,
        statusClass: "2xx" as const,
        contentType: contentTypeCategory(response.headers.get("content-type")),
        byteLength: Buffer.byteLength(raw, "utf8")
      };
      if (metadata.contentType !== "json") throw new ProviderResponseError("RESPONSE_NON_JSON", metadata);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new ProviderResponseError("RESPONSE_JSON_INVALID", metadata);
      }
      return { output_text: readOutputText(payload) };
    }
  };
}

function readOutputText(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length !== 1) return undefined;
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as { message?: unknown }).message : undefined;
  return message && typeof message === "object" ? (message as { content?: unknown }).content : undefined;
}

function contentTypeCategory(value: string | null): "json" | "html" | "text" | "other" | "missing" {
  if (!value) return "missing";
  const normalized = value.toLowerCase();
  if (normalized.includes("json")) return "json";
  if (normalized.includes("html")) return "html";
  if (normalized.startsWith("text/")) return "text";
  return "other";
}
