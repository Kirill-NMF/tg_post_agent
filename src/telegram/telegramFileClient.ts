import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TelegramDownloadedFile } from "../domain/audioTypes.js";

export const telegramCloudMaxDownloadBytes = 20 * 1024 * 1024;

export type TelegramFileClientPort = {
  downloadFile(input: { fileId: string; targetPath: string }): Promise<TelegramDownloadedFile>;
};

export type TelegramFileClientConfig = {
  botToken: string;
  apiBaseUrl?: string;
  maxDownloadBytes?: number;
  fetch?: typeof fetch;
};

type TelegramGetFileResponse = {
  ok?: boolean;
  result?: {
    file_id?: string;
    file_unique_id?: string;
    file_size?: number;
    file_path?: string;
  };
  description?: string;
};

export class TelegramFileClient implements TelegramFileClientPort {
  private readonly apiBaseUrl: string;
  private readonly maxDownloadBytes: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: TelegramFileClientConfig) {
    this.apiBaseUrl = (config.apiBaseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");
    this.maxDownloadBytes = config.maxDownloadBytes ?? telegramCloudMaxDownloadBytes;
    this.fetchFn = config.fetch ?? fetch;
  }

  async downloadFile(input: { fileId: string; targetPath: string }): Promise<TelegramDownloadedFile> {
    const metadata = await this.getFile(input.fileId);
    if (!metadata.file_path) throw new Error("Telegram getFile response did not include file_path.");
    if (metadata.file_size !== undefined && metadata.file_size > this.maxDownloadBytes) {
      throw new Error(`Telegram file is too large for configured download limit (${this.maxDownloadBytes} bytes).`);
    }

    const response = await this.fetchFn(this.downloadUrl(metadata.file_path));
    if (!response.ok) throw new Error(`Telegram file download failed with status ${response.status}.`);

    const contentLength = numberHeader(response.headers.get("content-length"));
    if (contentLength !== undefined && contentLength > this.maxDownloadBytes) {
      throw new Error(`Telegram file download is too large for configured limit (${this.maxDownloadBytes} bytes).`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > this.maxDownloadBytes) {
      throw new Error(`Telegram file download exceeded configured limit (${this.maxDownloadBytes} bytes).`);
    }

    await mkdir(dirname(input.targetPath), { recursive: true });
    await rm(input.targetPath, { force: true });
    await writeFile(input.targetPath, bytes);

    return {
      fileId: metadata.file_id ?? input.fileId,
      filePath: metadata.file_path,
      sizeBytes: metadata.file_size ?? bytes.byteLength
    };
  }

  private async getFile(fileId: string): Promise<NonNullable<TelegramGetFileResponse["result"]>> {
    const response = await this.fetchFn(`${this.apiBaseUrl}/bot${this.config.botToken}/getFile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: fileId })
    });
    if (!response.ok) throw new Error(`Telegram getFile failed with status ${response.status}.`);

    const body = (await response.json()) as TelegramGetFileResponse;
    if (!body.ok || !body.result) throw new Error(`Telegram getFile failed: ${safeTelegramDescription(body.description)}.`);
    return body.result;
  }

  private downloadUrl(filePath: string): string {
    const encodedPath = filePath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${this.apiBaseUrl}/file/bot${this.config.botToken}/${encodedPath}`;
  }
}

function numberHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safeTelegramDescription(value: string | undefined): string {
  return (value ?? "unknown error").replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]").slice(0, 300);
}
