import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { TempAudioStorage } from "../src/audio/tempAudioStorage.js";

describe("TempAudioStorage", () => {
  it("creates project/job scoped directories inside the configured base dir", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "tg-audio-temp-"));
    const storage = new TempAudioStorage({ baseDir });

    const workspace = await storage.createJobWorkspace({ projectId: "project-1", jobId: "job-1" });

    expect(workspace.dir.startsWith(baseDir)).toBe(true);
    await expect(stat(workspace.dir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("refuses resolved paths that escape the base dir", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "tg-audio-temp-"));
    const storage = new TempAudioStorage({ baseDir });

    expect(() => storage.resolveInside("../outside.mp3")).toThrow("escapes audio temp directory");
  });

  it("cleans job directories idempotently", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "tg-audio-temp-"));
    const storage = new TempAudioStorage({ baseDir });
    const workspace = await storage.createJobWorkspace({ projectId: "project-1", jobId: "job-1" });
    await writeFile(join(workspace.dir, "source.oga"), "audio");

    await storage.cleanup(workspace.dir);
    await storage.cleanup(workspace.dir);

    await expect(stat(workspace.dir)).rejects.toThrow();
  });
});
