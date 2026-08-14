import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { GeminiPlanningAdapter } from "../src/adapters/geminiPlanningAdapter.js";
import { createOpenRouterInteractionClient } from "../src/adapters/openRouterInteractionClient.js";
import { OpenRouterTranscriptionAdapter } from "../src/adapters/openRouterTranscriptionAdapter.js";
import { FallbackPlanningAdapter, FallbackTranscriptionAdapter } from "../src/adapters/providerFallbackAdapters.js";
import { ProviderRequestError } from "../src/adapters/providerErrors.js";
import type { PlanSplitAdapter } from "../src/adapters/geminiPlanningAdapter.js";
import type { TranscriptionAdapter } from "../src/domain/audioTypes.js";

const planInput = { projectId: "project-1", transcript: "SECRET TRANSCRIPT", planningHistory: [] };

describe("OpenRouter provider boundary", () => {
  it("maps chat structured output without logging the prompt", async () => {
    let received: Record<string, unknown> | undefined;
    const client = createOpenRouterInteractionClient({
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        received = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: "{\\\"ok\\\":true}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    await expect(client.create({ model: "google/gemini-2.5-pro", input: "SECRET TRANSCRIPT", response_format: { type: "text", mime_type: "application/json", schema: { type: "object" } } })).resolves.toEqual({ output_text: "{\\\"ok\\\":true}" });
    expect(received).toMatchObject({ model: "google/gemini-2.5-pro", response_format: { type: "json_object" } });
    expect((received?.messages as Array<{ role: string; content: string }>)[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("\"type\":\"object\"")
    });
    expect(JSON.stringify(received)).toContain("SECRET TRANSCRIPT");
  });

  it.each([
    ["text/html", "<html>gateway</html>", "RESPONSE_NON_JSON", "html"],
    ["text/plain", "upstream text", "RESPONSE_NON_JSON", "text"],
    ["application/json", "{bad", "RESPONSE_JSON_INVALID", "json"]
  ])("maps malformed upstream response metadata without exposing its body", async (contentType, body, code, category) => {
    const client = createOpenRouterInteractionClient({ apiKey: "test-key", fetchImpl: async () => new Response(body, { status: 200, headers: { "content-type": contentType } }) });
    await expect(client.create({ model: "model", input: "SECRET TRANSCRIPT", response_format: { type: "text", mime_type: "application/json", schema: {} } }))
      .rejects.toMatchObject({ code, metadata: { endpoint: "openrouter_chat_completions", statusClass: "2xx", contentType: category, byteLength: body.length } });
  });

  it("turns an aborted request into one retryable timeout without logging prompt content", async () => {
    const client = createOpenRouterInteractionClient({
      apiKey: "test-key",
      requestTimeoutMs: 1,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    });

    await expect(
      client.create({ model: "google/gemini-2.5-pro", input: "SECRET TRANSCRIPT", response_format: { type: "text", mime_type: "application/json", schema: { type: "object" } } })
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("does not use a direct fallback after an OpenRouter HTTP 400 or log the transcript", async () => {
    let fallbackCalls = 0;
    const logs: Array<Record<string, unknown>> = [];
    const primary = new GeminiPlanningAdapter({
      client: { create: async () => { throw new ProviderRequestError("HTTP_400", false); } },
      model: "google/gemini-2.5-pro",
      provider: "openrouter",
      logger: {
        info(fields) { logs.push(fields); },
        warn(fields) { logs.push(fields); },
        error(fields) { logs.push(fields); }
      }
    });
    const fallback: PlanSplitAdapter = {
      planSplit: async () => {
        fallbackCalls += 1;
        return { ok: false, error: { code: "UNUSED", message: "unused", retryable: false } };
      },
      revisePlan: async () => ({ ok: false, error: { code: "UNUSED", message: "unused", retryable: false } })
    };
    const adapter = new FallbackPlanningAdapter({ primary, primaryProvider: "openrouter", fallback, fallbackProvider: "gemini" });

    const result = await adapter.planSplit(planInput);

    expect(result).toMatchObject({ ok: false, error: { code: "GEMINI_PLAN_OUTPUT_INVALID", retryable: false } });
    expect(fallbackCalls).toBe(0);
    expect(JSON.stringify(logs)).not.toContain("SECRET TRANSCRIPT");
  });

  it("maps OpenRouter transcription chunks with its configured model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tg-openrouter-"));
    const filePath = join(dir, "chunk-000.mp3");
    await writeFile(filePath, "fixture");
    const adapter = new OpenRouterTranscriptionAdapter({ apiKey: "test-key", request: async ({ model }) => ({ text: model }) });
    const result = await adapter.transcribe({ projectId: "project-1", jobId: "job-1", source: { kind: "source_audio", telegramFileId: "file-1" }, chunks: [{ index: 0, path: filePath }] });
    expect(result).toMatchObject({ transcript: "openai/whisper-large-v3", meta: { provider: "openrouter", modelLabel: "openai/whisper-large-v3" } });
  });

  it("uses one direct fallback only for retryable provider failures", async () => {
    let fallbackCalls = 0;
    const primary: TranscriptionAdapter = { transcribe: async () => { throw new ProviderRequestError("HTTP_429", true); } };
    const fallback: TranscriptionAdapter = { transcribe: async () => { fallbackCalls += 1; return { transcript: "safe", meta: { provider: "whisper", modelLabel: "whisper-1", chunkCount: 1 } }; } };
    const adapter = new FallbackTranscriptionAdapter({ primary, primaryProvider: "openrouter", fallback, fallbackProvider: "whisper" });
    await expect(adapter.transcribe({ projectId: "p", jobId: "j", source: { kind: "source_audio", telegramFileId: "f" }, chunks: [] })).resolves.toMatchObject({ transcript: "safe" });
    expect(fallbackCalls).toBe(1);
  });

  it("does not fallback after permanent model output failure", async () => {
    let fallbackCalls = 0;
    const primary: PlanSplitAdapter = { planSplit: async () => ({ ok: false, error: { code: "INVALID_OUTPUT", message: "invalid", retryable: false } }), revisePlan: async () => ({ ok: false, error: { code: "INVALID_OUTPUT", message: "invalid", retryable: false } }) };
    const fallback: PlanSplitAdapter = { planSplit: async () => { fallbackCalls += 1; return { ok: false, error: { code: "UNUSED", message: "unused", retryable: false } }; }, revisePlan: async () => { fallbackCalls += 1; return { ok: false, error: { code: "UNUSED", message: "unused", retryable: false } }; } };
    const adapter = new FallbackPlanningAdapter({ primary, primaryProvider: "openrouter", fallback, fallbackProvider: "gemini" });
    const result = await adapter.planSplit(planInput);
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_OUTPUT" } });
    expect(fallbackCalls).toBe(0);
  });
});
