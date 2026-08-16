import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { createDb, createDbPool } from "../../dist/src/db/connection.js";
import { PgProjectRepository } from "../../dist/src/repositories/pgProjectRepository.js";
import { PgJobRepository } from "../../dist/src/repositories/pgJobRepository.js";
import { ProjectService } from "../../dist/src/services/projectService.js";

const marker = "tier2-correction-canary-v1";
const statePath = "/tmp/tg-post-agent-correction-canary-state.json";
const formatStatePath = "/tmp/tg-post-agent-correction-format-state.json";

export const correctionFixtureMarker = marker;
export const correctionFixtureStatePath = statePath;
export const correctionFormatStatePath = formatStatePath;
const syntheticTranscript = "Тестовый абзац: punctuation, mixed English.\n\nВторой абзац — only fixture data.";

export function buildRewriteFixture({ accountId, transcript, marker: fixtureMarker, now }) {
  if (!/^[1-9][0-9]*$/.test(accountId) || !transcript.trim() || !fixtureMarker) throw new Error("invalid_fixture_input");
  const plan = { optionId:"fixture_one",postCount:1,title:"Fixture",angle:"Fixture",summary:"Fixture",posts:[{index:1,topic:"Fixture",angle:"Fixture",includes:["Fixture"]}] };
  return { id:randomUUID(),telegramUserId:accountId,chatId:accountId,state:"rewrite_mode",isActive:true,transcript,selectedPlan:plan,rewriteMode:"clean_up",posts:[{id:randomUUID(),index:1,planSlice:plan.posts[0]}],currentPostIndex:1,messages:[{kind:"command",text:fixtureMarker,createdAt:now}],createdAt:now,updatedAt:now };
}
export function cleanupTargetMatches(expected, candidate) { return expected.projectId===candidate.projectId && expected.marker===candidate.marker && expected.accountId===candidate.accountId; }
export function draftEnqueueGuard({ fixture, accountId, activeDraftJobCount }) {
 if (!fixture || fixture.telegramUserId !== accountId || fixture.state !== "rewrite_mode" || !fixture.selectedPlan || fixture.messages?.some(x => x.kind === "command" && x.text === marker) !== true) return "fixture_invalid";
 if (activeDraftJobCount !== 0) return "draft_job_already_active";
 return null;
}
export function heldDraftEnqueue(now = new Date()) { return { runAfter: new Date(now.getTime() + 15 * 60_000), maxAttempts: 1 }; }
export function rollbackMatches(job, fixture) { return Boolean(job && fixture && job.projectId === fixture.id && job.dedupeKey === "fixture:" + fixture.id + ":generate_draft"); }

export function formatEnqueueGuard({ fixture, accountId, expectedDraftVersion, activeFormatJobCount }) {
 const post=fixture?.posts?.find((item)=>item.index===fixture.currentPostIndex);
 if (!fixture || fixture.telegramUserId!==accountId || fixture.state!=="draft_editing" || !fixture.selectedPlan || fixture.messages?.some((item)=>item.kind==="command"&&item.text===marker)!==true || !post?.currentDraft?.trim()) return "fixture_invalid";
 if (!Number.isInteger(expectedDraftVersion) || expectedDraftVersion < 1 || post.draftVersion!==expectedDraftVersion) return "draft_version_stale";
 if (activeFormatJobCount!==0) return "format_job_already_active";
 return null;
}
export function heldFormatEnqueue(now = new Date()) { return { runAfter:new Date(now.getTime()+15*60_000), maxAttempts:1 }; }
export function formatRollbackMatches(job, fixture) { return Boolean(job && fixture && job.projectId===fixture.id && job.dedupeKey==="fixture:"+fixture.id+":format:option_2"); }
export async function atomicPrivateState(path, value) {
 const temporary=path+".tmp-"+process.pid;
 await writeFile(temporary,JSON.stringify(value)+"\n",{mode:0o600}); await chmod(temporary,0o600); await rename(temporary,path); await chmod(path,0o600);
}
export async function prepareHeldOption2({projects,jobs,fixture,accountId,expectedDraftVersion,activeFormatJobCount,now=new Date(),writePrivateState,cancelExactJob}) {
 const category=formatEnqueueGuard({fixture,accountId,expectedDraftVersion,activeFormatJobCount}); if(category) throw new Error(category);
 const originalState=fixture.state, originalPost=fixture.posts.find((item)=>item.index===fixture.currentPostIndex), originalFormattingOption=originalPost?.formattingOption;
 const hold=heldFormatEnqueue(now); let createdJob;
 const guardedJobs={enqueue:async(input)=>{
   if (createdJob || input.type!=="FORMAT_POST" || input.projectId!==fixture.id || input.postId!==originalPost.id || input.payload?.formattingOption!=="option_2") throw new Error("format_job_scope_invalid");
   createdJob=await jobs.enqueue({...input,dedupeKey:"fixture:"+fixture.id+":format:option_2",maxAttempts:hold.maxAttempts,runAfter:hold.runAfter}); return createdJob;
 }};
 try {
   const service=new ProjectService(projects,{},guardedJobs,{formatting:1},true);
   await service.openFormatChoice(accountId); await service.formatCurrentPost(accountId,"option_2");
   if(!createdJob) throw new Error("format_job_not_enqueued");
   await writePrivateState({projectId:fixture.id,accountId,marker,jobId:createdJob.id,runAfter:hold.runAfter.toISOString(),draftVersion:expectedDraftVersion,formattingOption:"option_2"});
   return {job:createdJob,runAfter:hold.runAfter};
 } catch(error) {
   let rollbackFailed=false;
   try {
     if(createdJob) await cancelExactJob(createdJob,fixture);
     const current=await projects.findById(fixture.id); if(!current) throw new Error("fixture_missing");
     current.state=originalState; const currentPost=current.posts.find((item)=>item.id===originalPost.id); if(!currentPost) throw new Error("fixture_post_missing");
     currentPost.formattingOption=originalFormattingOption; await projects.save(current);
   } catch { rollbackFailed=true; }
   if(rollbackFailed) throw new Error("fixture_format_rollback_failed");
   throw error;
 }
}

async function main() {
 const action=process.argv[2], databaseUrl=requireValue("DATABASE_URL"), accountId=requirePositiveInteger("TG_POST_AGENT_CORRECTION_CANARY_ACCOUNT_ID");
 if (!databaseUrl.includes("tg_post_agent") || databaseUrl.includes("tg_post_agent_test")) throw new Error("unsafe_database_target");
 const pool=createDbPool({databaseUrl}),db=createDb(pool),projects=new PgProjectRepository(db),jobs=new PgJobRepository(db);
 try {
  if(action==="enqueue_format_option2") {
   const state=JSON.parse(await readFile(statePath,"utf8")); if(state.marker!==marker||state.accountId!==accountId) throw new Error("fixture_identity_mismatch");
   const fixture=await projects.findById(state.projectId); const post=fixture?.posts?.find((item)=>item.index===fixture.currentPostIndex); const active=(await db.execute(sql`select count(*)::int as count from jobs where project_id=${state.projectId} and type='FORMAT_POST' and status in ('queued','running','retry_scheduled')`)).rows[0]?.count ?? 0;
   const expectedDraftVersion=post?.draftVersion;
   const result=await prepareHeldOption2({projects,jobs,fixture,accountId,expectedDraftVersion,activeFormatJobCount:Number(active),writePrivateState:(value)=>atomicPrivateState(formatStatePath,value),cancelExactJob:async(job,currentFixture)=>{await db.execute(sql`update jobs set status='cancelled', finished_at=now(), updated_at=now() where id=${job.id} and project_id=${currentFixture.id} and dedupe_key=${"fixture:"+currentFixture.id+":format:option_2"} and status in ('queued','retry_scheduled')`);}});
   console.log(JSON.stringify({fixtureResolved:true,markerOwned:true,jobEnqueued:Boolean(result.job),jobType:"FORMAT_POST",formattingOption:"option_2",maxAttempts:1,held:true}));
  } else if(action==="enqueue_draft") {
   const state=JSON.parse(await readFile(statePath,"utf8")); if(state.marker!==marker||state.accountId!==accountId) throw new Error("fixture_identity_mismatch");
   const fixture=await projects.findById(state.projectId); const active=(await db.execute(sql`select count(*)::int as count from jobs where project_id=${state.projectId} and type='GENERATE_DRAFT' and status in ('queued','running','retry_scheduled')`)).rows[0]?.count ?? 0;
   const category=draftEnqueueGuard({fixture,accountId,activeDraftJobCount:Number(active)}); if(category) throw new Error(category);
   const post=fixture.posts.find(x=>x.index===fixture.currentPostIndex); if(!post) throw new Error("fixture_invalid"); const previousState=fixture.state, hold=heldDraftEnqueue();
   let createdJob; try { fixture.state="draft_generating"; await projects.save(fixture); createdJob=await jobs.enqueue({type:"GENERATE_DRAFT",projectId:fixture.id,postId:post.id,dedupeKey:"fixture:"+fixture.id+":generate_draft",payload:{postIndex:fixture.currentPostIndex,rewriteMode:fixture.rewriteMode},maxAttempts:hold.maxAttempts,runAfter:hold.runAfter}); await writeState({projectId:fixture.id,marker,accountId,jobId:createdJob.id,runAfter:hold.runAfter.toISOString()}); console.log(JSON.stringify({fixtureResolved:true,markerOwned:true,jobEnqueued:true,jobType:"GENERATE_DRAFT",maxAttempts:1,held:true})); } catch(error) { let rollbackCategory; try { if(createdJob) await db.execute(sql`update jobs set status='cancelled', finished_at=now(), updated_at=now() where id=${createdJob.id} and project_id=${fixture.id} and dedupe_key=${"fixture:"+fixture.id+":generate_draft"} and status in ('queued','retry_scheduled')`); fixture.state=previousState; await projects.save(fixture); } catch { rollbackCategory="fixture_rollback_failed"; } if(rollbackCategory) throw new Error(rollbackCategory); throw error; }
  } else if(action==="create_rewrite" || action==="--synthetic-transcript") {
   const transcript=action==="--synthetic-transcript" ? syntheticFixtureTranscript() : await privateTranscript(db,accountId); const fixture=buildRewriteFixture({accountId,transcript,marker,now:new Date()});
   await cleanup(projects,db,accountId); await projects.deactivateActiveForUser(accountId); await projects.save(fixture); await writeState({projectId:fixture.id,marker,accountId}); console.log(JSON.stringify({fixtureCreated:true,state:"rewrite_mode",hasSelectedPlan:true,recipientBound:true}));
  } else if(action==="cleanup") await cleanup(projects,db,accountId); else throw new Error("unsupported_action");
 } finally { await pool.end(); }
}
export function syntheticFixtureTranscript() { if(process.env.TG_POST_AGENT_SYNTHETIC_FIXTURE !== "true") throw new Error("synthetic_fixture_not_enabled"); return syntheticTranscript; }
async function privateTranscript(db,accountId) { const r=await db.execute(sql`select p.transcript from projects p join users u on u.id=p.user_id where u.telegram_user_id=${BigInt(accountId)} and p.transcript is not null order by p.updated_at desc limit 1`); const value=r.rows[0]?.transcript; if(typeof value!=="string"||!value.trim()) throw new Error("transcript_source_unavailable"); return value; }
async function cleanup(projects,db,accountId) { let s; try{s=JSON.parse(await readFile(statePath,"utf8"));}catch(e){if(e?.code==="ENOENT")return;throw new Error("invalid_fixture_state");} if(!cleanupTargetMatches({projectId:s.projectId,marker,accountId},{projectId:s.projectId,marker:s.marker,accountId:s.accountId}))throw new Error("fixture_identity_mismatch"); let formatState; try{formatState=JSON.parse(await readFile(formatStatePath,"utf8"));}catch(e){if(e?.code!=="ENOENT")throw new Error("invalid_format_fixture_state");} if(formatState&&!cleanupTargetMatches({projectId:s.projectId,marker,accountId},{projectId:formatState.projectId,marker:formatState.marker,accountId:formatState.accountId}))throw new Error("fixture_identity_mismatch"); const p=await projects.findById(s.projectId); if(!p||p.telegramUserId!==accountId||!p.messages.some(x=>x.kind==="command"&&x.text===marker))throw new Error("fixture_identity_mismatch"); await db.execute(sql`delete from projects where id=${s.projectId}`);await unlink(statePath);if(formatState)await unlink(formatStatePath);console.log(JSON.stringify({fixtureCleaned:true})); }
async function writeState(v){await atomicPrivateState(statePath,v);}
function requireValue(n){const v=process.env[n]?.trim();if(!v)throw new Error("configuration");return v;}function requirePositiveInteger(n){const v=requireValue(n);if(!/^[1-9][0-9]*$/.test(v))throw new Error("configuration");return v;}
if(import.meta.url===new URL(process.argv[1],"file:").href) await main();
