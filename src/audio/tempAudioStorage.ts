import { mkdir, readdir, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { JobId } from "../domain/jobTypes.js";
import type { ProjectId } from "../domain/types.js";

export type TempAudioWorkspace = {
  dir: string;
  sourcePath: string;
};

export class TempAudioStorage {
  private readonly baseDir: string;

  constructor(config: { baseDir: string }) {
    this.baseDir = resolve(config.baseDir);
  }

  async createJobWorkspace(input: { projectId: ProjectId; jobId: JobId }): Promise<TempAudioWorkspace> {
    const dir = this.resolveInside(input.projectId, input.jobId);
    await mkdir(dir, { recursive: true });
    return { dir, sourcePath: this.resolveInside(input.projectId, input.jobId, "source") };
  }

  resolveInside(...segments: string[]): string {
    const target = resolve(this.baseDir, ...segments);
    const pathRelativeToBase = relative(this.baseDir, target);
    if (pathRelativeToBase === "" || (!pathRelativeToBase.startsWith("..") && !isAbsolute(pathRelativeToBase))) {
      return target;
    }
    throw new Error("Resolved path escapes audio temp directory.");
  }

  async cleanup(path: string): Promise<void> {
    const safePath = this.assertInside(path);
    await rm(safePath, { recursive: true, force: true });
  }

  async listProjectWorkspaces(projectId: ProjectId): Promise<string[]> {
    const projectDir = this.resolveInside(projectId);
    try {
      return await readdir(projectDir);
    } catch {
      return [];
    }
  }

  private assertInside(path: string): string {
    const target = resolve(path);
    const pathRelativeToBase = relative(this.baseDir, target);
    if (pathRelativeToBase === "" || (!pathRelativeToBase.startsWith("..") && !isAbsolute(pathRelativeToBase))) {
      return target;
    }
    throw new Error("Resolved path escapes audio temp directory.");
  }
}
