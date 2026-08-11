import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { TelegramFileClient } from "../src/telegram/telegramFileClient.js";

describe("TelegramFileClient", () => {
  it("gets file metadata and downloads bytes without exposing the bot token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { file_id: "file-1", file_path: "voice/file.oga", file_size: 5 } }))
      .mockResolvedValueOnce(bytesResponse("hello"));
    const dir = await mkdtemp(join(tmpdir(), "tg-file-client-"));
    const targetPath = join(dir, "source.oga");
    const client = new TelegramFileClient({ botToken: "123:secret-token", fetch: fetchMock, maxDownloadBytes: 20_000_000 });

    const result = await client.downloadFile({ fileId: "file-1", targetPath });

    expect(result).toMatchObject({ fileId: "file-1", filePath: "voice/file.oga", sizeBytes: 5 });
    expect(await readFile(targetPath, "utf8")).toBe("hello");
  });

  it("rejects files larger than the configured cloud Bot API limit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true, result: { file_id: "file-1", file_path: "big.oga", file_size: 21 } }));
    const client = new TelegramFileClient({ botToken: "123:secret-token", fetch: fetchMock, maxDownloadBytes: 20 });

    await expect(client.downloadFile({ fileId: "file-1", targetPath: join(tmpdir(), "big.oga") })).rejects.toThrow("too large");
  });

  it("rejects getFile results without file_path", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true, result: { file_id: "file-1", file_size: 1 } }));
    const client = new TelegramFileClient({ botToken: "123:secret-token", fetch: fetchMock });

    await expect(client.downloadFile({ fileId: "file-1", targetPath: join(tmpdir(), "missing.oga") })).rejects.toThrow("file_path");
  });

  it("redacts bot-token-like text from getFile failure descriptions", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: false, description: "bad bot123:secret-token value" }));
    const client = new TelegramFileClient({ botToken: "123:secret-token", fetch: fetchMock });

    let message = "";
    try {
      await client.downloadFile({ fileId: "file-1", targetPath: join(tmpdir(), "failure.oga") });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("bot[redacted]");
    expect(message).not.toContain("secret-token");
  });

  it("reports download failure without token leakage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { file_id: "file-1", file_path: "voice/file.oga", file_size: 5 } }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const dir = await mkdtemp(join(tmpdir(), "tg-file-client-"));
    const client = new TelegramFileClient({ botToken: "123:secret-token", fetch: fetchMock });

    let message = "";
    try {
      await client.downloadFile({ fileId: "file-1", targetPath: join(dir, "source.oga") });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/download failed/i);
    expect(message).not.toContain("secret-token");
    await expect(stat(join(dir, "source.oga"))).rejects.toThrow();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function bytesResponse(body: string): Response {
  return new Response(Buffer.from(body), { status: 200, headers: { "content-length": String(Buffer.byteLength(body)) } });
}
