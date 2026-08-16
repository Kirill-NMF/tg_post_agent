import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { createDb, createDbPool } from "../../dist/src/db/connection.js";
import { failedDecorationRecoveryGuard, invalidateFailedDecoration } from "../../dist/src/domain/failedDecorationRecovery.js";
import { atomicPrivateState, correctionFixtureMarker, correctionFormatStatePath } from "./correction_fixture.mjs";

const recoveryStatePath = "/tmp/tg-post-agent-correction-recovery-state.json";

export function recoveryMarkerFingerprint(marker) {
  return typeof marker === "string" ? createHash("sha256").update(marker).digest("hex").slice(0, 12) : undefined;
}

export async function recoverFailedDecorationScoped(input) {
  let evidenceStarted = false;
  try {
    return await input.transaction(async (scope) => {
      const category = failedDecorationRecoveryGuard({
        project: scope.project, accountId: input.accountId, recipientId: input.recipientId,
        marker: input.marker, expectedProjectId: input.expectedProjectId, expectedPostId: input.expectedPostId,
        expectedDraftVersion: input.expectedDraftVersion, latestFormatJob: scope.latestFormatJob, expectedFormatJobId: input.expectedFormatJobId,
        activeJobCount: scope.activeJobCount,
      });
      if (category) throw new Error(category);
      if (scope.currentArtifactCount !== 0) throw new Error("RECOVERY_CURRENT_ARTIFACT_PRESENT");
      const recovered = structuredClone(scope.project);
      invalidateFailedDecoration(recovered, input.expectedPostId, input.expectedDraftVersion);
      await scope.save(recovered);
      evidenceStarted = true;
      await input.writeEvidence({
        projectId: recovered.id, postId: input.expectedPostId, accountId: input.accountId,
        recipientId: input.recipientId, marker: input.marker, draftVersion: input.expectedDraftVersion,
        previousFormatJobId: scope.latestFormatJob.id, state: "draft_editing",
      });
      return { recovered: true, state: recovered.state, draftVersionPreserved: true };
    });
  } catch (error) {
    if (evidenceStarted) {
      try { await input.removeEvidence(); } catch { throw new Error("RECOVERY_EVIDENCE_ROLLBACK_FAILED"); }
    }
    throw error;
  }
}

async function loadPgScope(tx, state, accountId) {
  const projectRows = rowsOf(await tx.execute(sql`
    select p.id, p.telegram_chat_id, p.is_active, p.active_state, p.current_post_index,
           u.telegram_user_id, pp.id as post_id, pp.current_draft, pp.formatted_text,
           pp.final_text, pp.formatting_option, pp.draft_version,
           exists (
             select 1 from project_messages pm
             where pm.project_id = p.id and pm.kind = 'command' and pm.text = ${state.marker}
           ) as marker_owned
    from projects p
    join users u on u.id = p.user_id
    join project_posts pp on pp.project_id = p.id and pp.index = p.current_post_index
    where p.id = ${state.projectId} and u.telegram_user_id = ${BigInt(accountId)}
    for update of p, pp
  `));
  const row = projectRows[0];
  if (!row || !row.marker_owned) return { project: undefined, latestFormatJob: undefined, activeJobCount: 0, currentArtifactCount: 0 };
  const jobRows = rowsOf(await tx.execute(sql`
    select id, type, status, project_id, post_id, payload_json, attempts, max_attempts,
           run_after, created_at, updated_at
    from jobs where project_id = ${state.projectId} and type = 'FORMAT_POST'
    order by created_at desc limit 1
  `));
  const activeRows = rowsOf(await tx.execute(sql`
    select count(*)::int as count from jobs
    where project_id = ${state.projectId} and status in ('queued','running','retry_scheduled')
  `));
  const artifactRows = rowsOf(await tx.execute(sql`
    select count(*)::int as count from artifacts where project_id = ${state.projectId} and post_id = ${row.post_id}
  `));
  const project = {
    id: row.id, telegramUserId: String(row.telegram_user_id), chatId: String(row.telegram_chat_id),
    state: row.active_state, isActive: row.is_active, currentPostIndex: row.current_post_index,
    posts: [{
      id: row.post_id, index: row.current_post_index,
      planSlice: { index: row.current_post_index, topic: "private", angle: "private", includes: [] },
      currentDraft: row.current_draft ?? undefined, formattedText: row.formatted_text ?? undefined,
      finalText: row.final_text ?? undefined, formattingOption: row.formatting_option ?? undefined,
      draftVersion: row.draft_version,
    }],
    messages: [{ kind: "command", text: state.marker, createdAt: new Date(0) }],
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const jobRow = jobRows[0];
  const latestFormatJob = jobRow ? {
    id: jobRow.id, type: jobRow.type, status: jobRow.status, projectId: jobRow.project_id ?? undefined,
    postId: jobRow.post_id ?? undefined, payload: jobRow.payload_json, attempts: jobRow.attempts,
    maxAttempts: jobRow.max_attempts, runAfter: jobRow.run_after, createdAt: jobRow.created_at, updatedAt: jobRow.updated_at,
  } : undefined;
  return {
    project, latestFormatJob,
    activeJobCount: Number(activeRows[0]?.count ?? 0),
    currentArtifactCount: Number(artifactRows[0]?.count ?? 0),
    async save(recovered) {
      const post = recovered.posts[0];
      const projectUpdate = await tx.execute(sql`
        update projects set active_state = 'draft_editing', formatting_option = null, completed_at = null, updated_at = now()
        where id = ${recovered.id} and active_state = 'formatted_editing'
      `);
      const postUpdate = await tx.execute(sql`
        update project_posts
        set formatted_text = null, final_text = null, formatting_option = null,
            formatted_version = 0, finalized_at = null, updated_at = now()
        where id = ${post.id} and project_id = ${recovered.id} and draft_version = ${post.draftVersion}
      `);
      if (rowCount(projectUpdate) !== 1 || rowCount(postUpdate) !== 1) throw new Error("RECOVERY_CONCURRENT_STATE_CHANGE");
    },
  };
}

async function main() {
  if (process.argv[2] !== "recover_zero_emoji") throw new Error("unsupported_action");
  const databaseUrl = requireValue("DATABASE_URL");
  const accountId = requirePositiveInteger("TG_POST_AGENT_CORRECTION_CANARY_ACCOUNT_ID");
  if (!databaseUrl.includes("tg_post_agent") || databaseUrl.includes("tg_post_agent_test")) throw new Error("unsafe_database_target");
  const state = JSON.parse(await readFile(correctionFormatStatePath, "utf8"));
  if (state.marker !== correctionFixtureMarker || state.accountId !== accountId || state.formattingOption !== "option_2") throw new Error("RECOVERY_SCOPE_INVALID");
  const pool = createDbPool({ databaseUrl });
  const db = createDb(pool);
  try {
    const result = await recoverFailedDecorationScoped({
      accountId, recipientId: accountId, marker: state.marker, expectedProjectId: state.projectId,
      expectedPostId: await currentPostId(db, state.projectId), expectedFormatJobId: state.jobId, expectedDraftVersion: state.draftVersion,
      transaction: (callback) => db.transaction(async (tx) => callback(await loadPgScope(tx, state, accountId))),
      writeEvidence: (value) => atomicPrivateState(recoveryStatePath, value),
      removeEvidence: async () => { try { await unlink(recoveryStatePath); } catch (error) { if (error?.code !== "ENOENT") throw error; } },
    });
    console.log(JSON.stringify({
      recovered: result.recovered, state: result.state, draftVersionPreserved: result.draftVersionPreserved,
      markerFingerprint: recoveryMarkerFingerprint(state.marker),
    }));
  } finally {
    await pool.end();
  }
}

async function currentPostId(db, projectId) {
  const rows = rowsOf(await db.execute(sql`select pp.id from project_posts pp join projects p on p.id=pp.project_id and p.current_post_index=pp.index where p.id=${projectId} limit 1`));
  if (!rows[0]?.id) throw new Error("RECOVERY_SCOPE_INVALID");
  return rows[0].id;
}

function rowsOf(result) { return Array.isArray(result?.rows) ? result.rows : []; }
function rowCount(result) { return Number(result?.rowCount ?? 0); }
function requireValue(name) { const value = process.env[name]?.trim(); if (!value) throw new Error("configuration"); return value; }
function requirePositiveInteger(name) { const value = requireValue(name); if (!/^[1-9][0-9]*$/.test(value)) throw new Error("configuration"); return value; }

if (import.meta.url === new URL(process.argv[1], "file:").href) await main();
