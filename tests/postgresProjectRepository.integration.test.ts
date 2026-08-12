import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import { PgProjectRepository } from "../src/repositories/pgProjectRepository.js";
import { ProjectService } from "../src/services/projectService.js";
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
    const service = new ProjectService(repository, new MockModelAdapters());

    await service.start("100", "200");
    await service.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice-file-id" });
    await service.choosePlan("100", "recommended");
    await service.chooseRewriteMode("100", "make_post");
    await service.reviseDraft("100", "shorten intro");
    await service.openFormatChoice("100");
    await service.formatCurrentPost("100", "option_2");
    await service.finalizeCurrentPost("100");

    const activeProject = await new PgProjectRepository(database.db).findActiveByTelegramUser("100");
    expect(activeProject?.state).toBe("done");
    expect(activeProject?.transcript).toContain("Mock transcript");
    expect(activeProject?.selectedPlan?.postCount).toBe(1);
    expect(activeProject?.planRecommendation).toMatchObject({ recommendedOptionId: "recommended", confidence: "high" });
    expect(activeProject?.planOptions).toHaveLength(1);
    expect(activeProject?.posts).toHaveLength(1);
    expect(activeProject?.posts[0]?.formattedText).toMatch(/^✨ Mock draft 1/);
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
});
