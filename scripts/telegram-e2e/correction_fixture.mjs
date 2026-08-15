import { randomUUID } from "node:crypto";
import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { createDb, createDbPool } from "../../dist/src/db/connection.js";
import { PgProjectRepository } from "../../dist/src/repositories/pgProjectRepository.js";

const marker = "tier2-correction-canary-v1";
const statePath = "/tmp/tg-post-agent-correction-canary-state.json";

export function buildRewriteFixture({ accountId, transcript, marker: fixtureMarker, now }) {
  if (!/^[1-9][0-9]*$/.test(accountId) || !transcript.trim() || !fixtureMarker) throw new Error("invalid_fixture_input");
  const plan = { optionId:"fixture_one",postCount:1,title:"Fixture",angle:"Fixture",summary:"Fixture",posts:[{index:1,topic:"Fixture",angle:"Fixture",includes:["Fixture"]}] };
  return { id:randomUUID(),telegramUserId:accountId,chatId:accountId,state:"rewrite_mode",isActive:true,transcript,selectedPlan:plan,rewriteMode:"clean_up",posts:[{id:randomUUID(),index:1,planSlice:plan.posts[0]}],currentPostIndex:1,messages:[{kind:"command",text:fixtureMarker,createdAt:now}],createdAt:now,updatedAt:now };
}
export function cleanupTargetMatches(expected, candidate) { return expected.projectId===candidate.projectId && expected.marker===candidate.marker && expected.accountId===candidate.accountId; }

async function main() {
 const action=process.argv[2], databaseUrl=requireValue("DATABASE_URL"), accountId=requirePositiveInteger("TG_POST_AGENT_CORRECTION_CANARY_ACCOUNT_ID");
 if (!databaseUrl.includes("tg_post_agent") || databaseUrl.includes("tg_post_agent_test")) throw new Error("unsafe_database_target");
 const pool=createDbPool({databaseUrl}),db=createDb(pool),projects=new PgProjectRepository(db);
 try {
  if(action==="create_rewrite") {
   const transcript=await privateTranscript(db,accountId); const fixture=buildRewriteFixture({accountId,transcript,marker,now:new Date()});
   await cleanup(projects,db,accountId); await projects.deactivateActiveForUser(accountId); await projects.save(fixture); await writeState({projectId:fixture.id,marker,accountId}); console.log(JSON.stringify({fixtureCreated:true,state:"rewrite_mode",hasSelectedPlan:true,recipientBound:true}));
  } else if(action==="cleanup") await cleanup(projects,db,accountId); else throw new Error("unsupported_action");
 } finally { await pool.end(); }
}
async function privateTranscript(db,accountId) { const r=await db.execute(sql`select p.transcript from projects p join users u on u.id=p.user_id where u.telegram_user_id=${BigInt(accountId)} and p.transcript is not null order by p.updated_at desc limit 1`); const value=r.rows[0]?.transcript; if(typeof value!=="string"||!value.trim()) throw new Error("transcript_source_unavailable"); return value; }
async function cleanup(projects,db,accountId) { let s; try{s=JSON.parse(await readFile(statePath,"utf8"));}catch(e){if(e?.code==="ENOENT")return;throw new Error("invalid_fixture_state");} if(!cleanupTargetMatches({projectId:s.projectId,marker,accountId},{projectId:s.projectId,marker:s.marker,accountId:s.accountId}))throw new Error("fixture_identity_mismatch"); const p=await projects.findById(s.projectId); if(!p||p.telegramUserId!==accountId||!p.messages.some(x=>x.kind==="command"&&x.text===marker))throw new Error("fixture_identity_mismatch"); await db.execute(sql`delete from projects where id=${s.projectId}`);await unlink(statePath);console.log(JSON.stringify({fixtureCleaned:true})); }
async function writeState(v){await writeFile(statePath,JSON.stringify(v)+"\n",{mode:0o600});await chmod(statePath,0o600);}
function requireValue(n){const v=process.env[n]?.trim();if(!v)throw new Error("configuration");return v;}function requirePositiveInteger(n){const v=requireValue(n);if(!/^[1-9][0-9]*$/.test(v))throw new Error("configuration");return v;}
if(import.meta.url===new URL(process.argv[1],"file:").href) await main();
