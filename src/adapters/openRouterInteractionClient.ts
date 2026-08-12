import { providerHttpError } from "./providerErrors.js";

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

export function createOpenRouterInteractionClient(input: { apiKey: string; fetchImpl?: typeof fetch }): OpenRouterInteractionClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    async create(request) {
      const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: "user", content: request.input }],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "tg_post_agent_response",
              strict: true,
              schema: request.response_format.schema
            }
          }
        })
      });
      if (!response.ok) throw providerHttpError(response.status);
      return { output_text: readOutputText((await response.json()) as unknown) };
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
