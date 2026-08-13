import { randomUUID } from "node:crypto";
import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { createDb, createDbPool } from "../../dist/src/db/connection.js";
import { PgProjectRepository } from "../../dist/src/repositories/pgProjectRepository.js";

const marker = "tier2-correction-canary-v1";
const statePath = "/tmp/tg-post-agent-correction-canary-state.json";

const action = process.argv[2];
const databaseUrl = requireValue("DATABASE_URL");
const accountId = requirePositiveInteger("TG_POST_AGENT_CORRECTION_CANARY_ACCOUNT_ID");
if (!databaseUrl.includes("tg_post_agent") || databaseUrl.includes("tg_post_agent_test")) {
  throw new Error("unsafe database target");
}

const pool = createDbPool({ databaseUrl });
const db = createDb(pool);
const projects = new PgProjectRepository(db);

try {
  if (action === "create") await createFixture();
  else if (action === "cleanup") await cleanupFixture();
  else throw new Error("unsupported action");
} finally {
  await pool.end();
}

async function createFixture() {
  await cleanupFixture();
  const now = new Date();
  const plan = {
    optionId: "canary_one",
    postCount: 1,
    title: "Synthetic planning fixture",
    angle: "Synthetic angle",
    summary: "Synthetic summary",
    posts: [{ index: 1, topic: "Synthetic topic", angle: "Synthetic angle", includes: ["Synthetic point"] }]
  };
  const project = {
    id: randomUUID(),
    telegramUserId: accountId,
    chatId: accountId,
    state: "planning",
    isActive: true,
    transcript: "Synthetic non-user source for the Tier 2 correction canary.",
    outputLanguage: "ru",
    planOptions: [plan],
    planRecommendation: { recommendedOptionId: plan.optionId, rationale: "Synthetic rationale", confidence: "high" },
    planAlternativesRevealed: false,
    posts: [],
    messages: [{ kind: "command", text: marker, createdAt: now }],
    createdAt: now,
    updatedAt: now
  };
  await projects.deactivateActiveForUser(accountId);
  await projects.save(project);
  await writeState({ projectId: project.id, marker });
  console.log('{"fixtureCreated":true}');
}

async function cleanupFixture() {
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw new Error("invalid fixture state");
  }
  if (!state || typeof state.projectId !== "string" || state.marker !== marker) {
    throw new Error("invalid fixture state");
  }
  const project = await projects.findById(state.projectId);
  if (!project || project.telegramUserId !== accountId || !project.messages.some((item) => item.kind === "command" && item.text === marker)) {
    throw new Error("fixture identity mismatch");
  }
  await db.execute(sql`delete from projects where id = ${state.projectId}`);
  await unlink(statePath);
  console.log('{"fixtureCleaned":true}');
}

async function writeState(value) {
  await writeFile(statePath, JSON.stringify(value) + "\n", { mode: 0o600 });
  await chmod(statePath, 0o600);
}

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function requirePositiveInteger(name) {
  const value = Number(requireValue(name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid ${name}`);
  return String(value);
}
