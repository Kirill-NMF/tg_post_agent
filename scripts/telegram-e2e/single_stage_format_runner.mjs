import { createHash } from "node:crypto";
import { Bot } from "grammy";
import { readFile, rename, writeFile } from "node:fs/promises";
import { createDb, createDbPool } from "../../dist/src/db/connection.js";
import { loadConfig } from "../../dist/src/config/env.js";
import { PgJobRepository } from "../../dist/src/repositories/pgJobRepository.js";
import { PgProjectRepository } from "../../dist/src/repositories/pgProjectRepository.js";
import { createAudioPipelineHandlers } from "../../dist/src/services/audioPipelineFactory.js";
import { JobWorker } from "../../dist/src/services/jobWorker.js";
import { GrammyTelegramNotifier } from "../../dist/src/telegram/telegramNotifier.js";

const defaultStatePath = "/tmp/tg-post-agent-correction-format-state.json";

export function markerFingerprint(marker) {
  return typeof marker === "string" ? createHash("sha256").update(marker).digest("hex").slice(0, 12) : undefined;
}

export function controlledNowFromFormatState(state, wallNow = Date.now()) {
  const runAfter = Date.parse(state?.runAfter);
  if (!state?.jobId || !state?.projectId || !state?.accountId || !state?.marker || state?.formattingOption !== "option_2" || !Number.isInteger(state?.draftVersion) || state.draftVersion < 1 || !Number.isFinite(runAfter) || runAfter <= wallNow) return undefined;
  return new Date(runAfter + 1);
}

export function formatExactPreflight({ state, project, job, wallNow = Date.now() }) {
  const controlledNow = controlledNowFromFormatState(state, wallNow);
  if (!controlledNow) return "private_state_invalid";
  const marker = project?.messages?.find((entry) => entry.kind === "command")?.text;
  if (!project || project.telegramUserId !== state.accountId || marker !== state.marker || project.state !== "formatting") return "fixture_scope_invalid";
  const post = project.posts?.find((entry) => entry.index === project.currentPostIndex);
  if (!post || post.id !== job?.postId || !post.currentDraft?.trim() || post.draftVersion !== state.draftVersion) return "draft_version_invalid";
  if (!job || job.id !== state.jobId || job.type !== "FORMAT_POST" || job.projectId !== project.id || job.status !== "queued" || job.maxAttempts !== 1 || job.dedupeKey !== "fixture:" + project.id + ":format:option_2" || job.payload?.postIndex !== project.currentPostIndex || job.payload?.formattingOption !== "option_2") return "job_scope_invalid";
  return null;
}

export async function atomicReport(path, report) {
  const temp = path + ".tmp-" + process.pid;
  await writeFile(temp, JSON.stringify(report) + "\n", { mode: 0o600 });
  await rename(temp, path);
}

export function providerBoundaryReport(report) {
  return { ...report, providerAttempted: true };
}

export function terminalEvidence({ job, project, expectedVersion }) {
  const post = project?.posts?.find((entry) => entry.index === project.currentPostIndex);
  return {
    jobSucceeded: job?.status === "succeeded",
    finalState: project?.state === "formatted_editing",
    formattedNonempty: Boolean(post?.formattedText?.trim()),
    draftVersionMatched: post?.draftVersion === expectedVersion,
    notificationSent: job?.result?.notificationStatus === "sent"
  };
}

async function main() {
  const reportPath = process.env.TG_POST_AGENT_SINGLE_STAGE_FORMAT_REPORT;
  const statePath = process.env.TG_POST_AGENT_FORMAT_FIXTURE_STATE_PATH ?? defaultStatePath;
  if (!reportPath) throw new Error("configuration");
  let report = { markerFingerprint: undefined, processed: false, category: null, preflightMaxProviderAttempts: 1, providerAttempted: false, jobSucceeded: false, finalState: false, formattedNonempty: false, draftVersionMatched: false, notificationSent: false };
  let pool;
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    report.markerFingerprint = markerFingerprint(state.marker);
    const controlledNow = controlledNowFromFormatState(state);
    if (!controlledNow) throw new Error("private_state_invalid");
    const config = loadConfig({ ...process.env, PROVIDER_FALLBACKS_ENABLED: "false" });
    pool = createDbPool({ databaseUrl: config.databaseUrl });
    const db = createDb(pool);
    const projects = new PgProjectRepository(db);
    const jobs = new PgJobRepository(db);
    const project = await projects.findById(state.projectId);
    const job = await jobs.findById(state.jobId);
    const category = formatExactPreflight({ state, project, job });
    if (category) throw new Error(category);
    const notifier = new GrammyTelegramNotifier(new Bot(config.botToken).api);
    const handlers = createAudioPipelineHandlers({ config, projects, jobs, notifier });
    if (!handlers.FORMAT_POST) throw new Error("format_handler_unavailable");
    report = providerBoundaryReport(report);
    const result = await new JobWorker(jobs, { FORMAT_POST: handlers.FORMAT_POST }).processOne({ workerId: "single-stage-format-runner", expectedJobId: state.jobId, now: controlledNow });
    report.processed = result.processed;
    report.category = result.processed ? result.status : "no_job";
    const finalJob = await jobs.findById(state.jobId);
    const finalProject = await projects.findById(state.projectId);
    Object.assign(report, terminalEvidence({ job: finalJob, project: finalProject, expectedVersion: state.draftVersion }));
    if (!report.jobSucceeded || !report.finalState || !report.formattedNonempty || !report.draftVersionMatched || !report.notificationSent) report.category = "terminal_verification_failed";
  } catch (error) {
    report.category = error instanceof Error ? error.message : "runner_failure";
  } finally {
    if (pool) await pool.end();
    await atomicReport(reportPath, report);
  }
  console.log(JSON.stringify(report));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) await main();
