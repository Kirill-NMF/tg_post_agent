import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import { PgJobRepository } from "../src/repositories/pgJobRepository.js";
import { PgProjectRepository } from "../src/repositories/pgProjectRepository.js";
import { ProjectService } from "../src/services/projectService.js";
import { JobWorker } from "../src/services/jobWorker.js";
import { openTestDatabase, type TestDatabaseHandle } from "./helpers/postgres.js";

const describeWithPostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;

let database: TestDatabaseHandle;

describeWithPostgres("PgProjectRepository", () => {
  beforeAll(async () => {
    const opened = await openTestDatabase(process.env);
    if (!opened) throw new Error("TEST_DATABASE_URL is required for Postgres integration tests.");
    database = opened;
  });

  afterAll(async () => {
    await database?.close();
  });

  beforeEach(async () => {
    await database.clean();
  });

  it("persists and hydrates the current mock project flow", async () => {
    const repository = new PgProjectRepository(database.db);
    const service = new ProjectService(repository, new MockModelAdapters(), undefined, undefined, true);

    await service.start("100", "200");
    await service.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice-file-id" });
    await service.choosePlan("100", "recommended");
    await service.chooseRewriteMode("100", "make_post");
    await service.reviseDraft("100", "\u041f\u0438\u0448\u0438 \u043f\u043e\u0441\u0442 \u043f\u043e-\u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u0438.");
    await service.openFormatChoice("100");
    await service.formatCurrentPost("100", "option_2");
    await service.finalizeCurrentPost("100");

    const activeProject = await new PgProjectRepository(database.db).findActiveByTelegramUser("100");
    expect(activeProject?.state).toBe("done");
    expect(activeProject?.transcript).toContain("Mock transcript");
    expect(activeProject?.selectedPlan?.postCount).toBe(1);
    expect(activeProject?.planRecommendation).toMatchObject({ recommendedOptionId: "recommended", confidence: "high" });
    expect(activeProject?.planOptions).toHaveLength(1);
    expect(activeProject?.outputLanguage).toBe("en");
    expect(activeProject?.posts).toHaveLength(1);
    expect(activeProject?.posts[0]?.formattedText).toMatch(/^✨Mock draft 1/);
    expect(activeProject?.posts[0]?.finalText).toBe(activeProject?.posts[0]?.formattedText);
    expect(activeProject?.messages.map((message) => message.kind)).toContain("final");

    const artifacts = await database.db.execute(sql`
      select type, status, file_name, content_text
      from artifacts
      where project_id = ${activeProject?.id}
    `);
    expect(artifacts.rows).toEqual([
      expect.objectContaining({
        type: "final_txt",
        status: "ready",
        file_name: "post-1.txt",
        content_text: activeProject?.posts[0]?.finalText
      })
    ]);
  });

  it("deactivates the previous active project when a new project starts", async () => {
    const repository = new PgProjectRepository(database.db);
    const service = new ProjectService(repository, new MockModelAdapters());

    await service.start("100", "200");
    const firstProject = await service.getActiveProject("100");
    await service.start("100", "200");
    const secondProject = await service.getActiveProject("100");

    expect(secondProject?.id).not.toBe(firstProject?.id);
    expect(secondProject?.state).toBe("awaiting_audio");
    expect(await repository.findById(firstProject?.id ?? "")).toMatchObject({ isActive: false, state: "cancelled" });
  });
  it("keeps a running job linked to a retained post when its handler saves the project", async () => {
    const projects = new PgProjectRepository(database.db);
    const jobs = new PgJobRepository(database.db);
    const service = new ProjectService(projects, new MockModelAdapters());
    await service.start("100", "200");
    await service.submitSourceAudio("100", { kind: "voice", telegramFileId: "fixture-voice" });
    await service.choosePlan("100", "recommended");
    const project = await service.getActiveProject("100");
    if (!project) throw new Error("Expected project.");
    project.state = "draft_generating";
    await projects.save(project);
    const post = project.posts[0];
    if (!post) throw new Error("Expected post.");
    const job = await jobs.enqueue({ type: "GENERATE_DRAFT", projectId: project.id, postId: post.id, payload: {} });

    const worker = new JobWorker(jobs, {
      GENERATE_DRAFT: async () => {
        const current = await projects.findById(project.id);
        if (!current?.posts[0]) throw new Error("Expected retained project post.");
        current.state = "draft_editing";
        current.posts[0].currentDraft = "deterministic draft";
        await projects.save(current);
      }
    });

    await expect(worker.processOne({ workerId: "worker" })).resolves.toMatchObject({ processed: true, status: "succeeded" });
    expect(await jobs.findById(job.id)).toMatchObject({ status: "succeeded", projectId: project.id, postId: post.id });
  });

  it("removes only stale posts while preserving jobs for retained posts and unrelated projects", async () => {
    const projects = new PgProjectRepository(database.db);
    const jobs = new PgJobRepository(database.db);
    const service = new ProjectService(projects, new MockModelAdapters());
    await service.start("100", "200");
    await service.submitSourceAudio("100", { kind: "voice", telegramFileId: "fixture-voice" });
    await service.choosePlan("100", "recommended");
    const project = await service.getActiveProject("100");
    if (!project?.posts[0]) throw new Error("Expected project post.");
    const retained = project.posts[0];
    project.posts.push({ ...retained, id: crypto.randomUUID(), index: 2 });
    await projects.save(project);
    const retainedJob = await jobs.enqueue({ type: "GENERATE_DRAFT", projectId: project.id, postId: retained.id, payload: {} });

    await service.start("101", "201");
    await service.submitSourceAudio("101", { kind: "voice", telegramFileId: "other-fixture-voice" });
    await service.choosePlan("101", "recommended");
    const unrelated = await service.getActiveProject("101");
    if (!unrelated?.posts[0]) throw new Error("Expected unrelated project post.");
    const unrelatedJob = await jobs.enqueue({ type: "PLAN_SPLIT", projectId: unrelated.id, postId: unrelated.posts[0].id, payload: {} });

    project.posts = [retained];
    await projects.save(project);

    expect((await projects.findById(project.id))?.posts).toHaveLength(1);
    expect(await jobs.findById(retainedJob.id)).toMatchObject({ projectId: project.id, postId: retained.id });
    expect(await jobs.findById(unrelatedJob.id)).toMatchObject({ projectId: unrelated.id, postId: unrelated.posts[0].id });
  });

});
