import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import { loadConfig } from "../src/config/env.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { ProjectService } from "../src/services/projectService.js";

describe("bounded correction job attempts", () => {
  it("keeps production defaults and accepts separate one-attempt edit and plan revision overrides", () => {
    const defaults = loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123" });
    expect(defaults.editAudioJobMaxAttempts).toBe(3);
    expect(defaults.planRevisionJobMaxAttempts).toBe(3);

    const bounded = loadConfig({
      BOT_TOKEN: "token",
      ALLOWED_TELEGRAM_IDS: "123",
      EDIT_AUDIO_JOB_MAX_ATTEMPTS: "1",
      PLAN_REVISION_JOB_MAX_ATTEMPTS: "1"
    });
    expect(bounded.editAudioJobMaxAttempts).toBe(1);
    expect(bounded.planRevisionJobMaxAttempts).toBe(1);
  });

  it("wires one-attempt caps to text plan revision and edit-audio jobs", async () => {
    const projects = new InMemoryProjectRepository();
    const models = new MockModelAdapters();
    const setup = new ProjectService(projects, models);
    await setup.start("100", "200");
    await setup.submitSourceAudio("100", { kind: "voice", telegramFileId: "synthetic-source" });

    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, models, jobs, { editAudio: 1, planRevision: 1 });
    await service.revisePlan("100", "Сделайте план короче.");
    const planJob = await jobs.claimNextDue({ workerId: "test" });
    expect(planJob).toMatchObject({ type: "REVISE_PLAN", maxAttempts: 1 });

    await service.handleEditAudio("100", { kind: "voice", telegramFileId: "synthetic-edit" });
    const editJob = await jobs.claimNextDue({ workerId: "test" });
    expect(editJob).toMatchObject({ type: "TRANSCRIBE_EDIT_AUDIO", maxAttempts: 1 });
  });
});
