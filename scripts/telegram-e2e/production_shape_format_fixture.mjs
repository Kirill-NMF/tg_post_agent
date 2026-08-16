import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { createDb, createDbPool } from "../../dist/src/db/connection.js";
import { PgJobRepository } from "../../dist/src/repositories/pgJobRepository.js";
import { PgProjectRepository } from "../../dist/src/repositories/pgProjectRepository.js";
import { atomicPrivateState, prepareHeldOption2 } from "./correction_fixture.mjs";

export const productionShapeFixtureMarker = "tier2-production-shape-option2-v1";
export const productionShapeFixtureStatePath = "/tmp/tg-post-agent-production-shape-fixture-state.json";
export const productionShapeFormatStatePath = "/tmp/tg-post-agent-production-shape-format-state.json";
const canonicalDraft = [
  "\u041f\u0435\u0440\u0432\u044b\u0439 \u0440\u0430\u0437\u0434\u0435\u043b \u043e\u043f\u0438\u0441\u044b\u0432\u0430\u0435\u0442 \u0441\u043f\u043e\u043a\u043e\u0439\u043d\u043e\u0435 \u043d\u0430\u0447\u0430\u043b\u043e \u0440\u0430\u0431\u043e\u0447\u0435\u0433\u043e \u0434\u043d\u044f, \u044f\u0441\u043d\u0443\u044e \u0446\u0435\u043b\u044c \u0438 \u043f\u043e\u0441\u043b\u0435\u0434\u043e\u0432\u0430\u0442\u0435\u043b\u044c\u043d\u044b\u0439 \u043f\u043e\u0440\u044f\u0434\u043e\u043a \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439 \u0434\u043b\u044f \u043d\u0435\u0431\u043e\u043b\u044c\u0448\u043e\u0439 \u043a\u043e\u043c\u0430\u043d\u0434\u044b.",
  "\u0412\u0442\u043e\u0440\u043e\u0439 \u0440\u0430\u0437\u0434\u0435\u043b \u043e\u0431\u044a\u044f\u0441\u043d\u044f\u0435\u0442, \u043a\u0430\u043a \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0438 \u0441\u0432\u0435\u0440\u044f\u044e\u0442 \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435, \u0443\u0442\u043e\u0447\u043d\u044f\u044e\u0442 \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u0438\u044f \u0438 \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u044e\u0442 \u043e\u0431\u0449\u0438\u0439 \u0441\u043c\u044b\u0441\u043b \u0431\u0435\u0437 \u043f\u043e\u0441\u043f\u0435\u0448\u043d\u044b\u0445 \u0432\u044b\u0432\u043e\u0434\u043e\u0432.",
  "\u0422\u0440\u0435\u0442\u0438\u0439 \u0440\u0430\u0437\u0434\u0435\u043b \u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u0442 \u043f\u0440\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u043f\u0440\u0438\u043c\u0435\u0440: \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440 \u043f\u0440\u043e\u0432\u0435\u0440\u044f\u0435\u0442 \u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0443, \u0430\u0432\u0442\u043e\u0440 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0435\u0442 \u0444\u0430\u043a\u0442\u044b, \u0430 \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440 \u0444\u0438\u043a\u0441\u0438\u0440\u0443\u0435\u0442 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442.",
  "\u0427\u0435\u0442\u0432\u0451\u0440\u0442\u044b\u0439 \u0440\u0430\u0437\u0434\u0435\u043b \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u0435\u0442, \u0447\u0442\u043e \u0430\u043a\u043a\u0443\u0440\u0430\u0442\u043d\u0430\u044f \u043f\u0443\u043d\u043a\u0442\u0443\u0430\u0446\u0438\u044f, \u0442\u043e\u0447\u043d\u044b\u0435 \u0444\u043e\u0440\u043c\u0443\u043b\u0438\u0440\u043e\u0432\u043a\u0438 \u0438 \u043f\u043e\u043d\u044f\u0442\u043d\u044b\u0435 \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u044b \u043f\u043e\u043c\u043e\u0433\u0430\u044e\u0442 \u0447\u0438\u0442\u0430\u0442\u0435\u043b\u044e \u0441\u043b\u0435\u0434\u0438\u0442\u044c \u0437\u0430 \u043c\u044b\u0441\u043b\u044c\u044e.",
  "\u041f\u044f\u0442\u044b\u0439 \u0440\u0430\u0437\u0434\u0435\u043b \u043f\u0435\u0440\u0435\u0447\u0438\u0441\u043b\u044f\u0435\u0442 \u043a\u0440\u0438\u0442\u0435\u0440\u0438\u0438 \u043a\u0430\u0447\u0435\u0441\u0442\u0432\u0430, \u0432\u043a\u043b\u044e\u0447\u0430\u044f \u043f\u043e\u043b\u043d\u043e\u0442\u0443, \u043b\u043e\u0433\u0438\u0447\u0435\u0441\u043a\u0443\u044e \u0441\u0432\u044f\u0437\u044c, \u0443\u0441\u0442\u043e\u0439\u0447\u0438\u0432\u044b\u0439 \u043f\u043e\u0440\u044f\u0434\u043e\u043a \u0441\u043b\u043e\u0432 \u0438 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u0435 \u0441\u043b\u0443\u0447\u0430\u0439\u043d\u044b\u0445 \u0437\u0430\u043c\u0435\u043d.",
  "\u0428\u0435\u0441\u0442\u043e\u0439 \u0440\u0430\u0437\u0434\u0435\u043b \u043f\u043e\u0441\u0432\u044f\u0449\u0451\u043d \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0435 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0430 \u043d\u0430 \u0434\u043b\u0438\u043d\u043d\u043e\u043c \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u0435, \u0433\u0434\u0435 \u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a\u043e \u0430\u0431\u0437\u0430\u0446\u0435\u0432 \u0442\u0440\u0435\u0431\u0443\u044e\u0442 \u0440\u0430\u0437\u043d\u044b\u0445 \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u044b\u0445 \u0434\u0435\u043a\u043e\u0440\u0430\u0442\u0438\u0432\u043d\u044b\u0445 \u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0439.",
  "\u0421\u0435\u0434\u044c\u043c\u043e\u0439 \u0440\u0430\u0437\u0434\u0435\u043b \u0437\u0430\u0432\u0435\u0440\u0448\u0430\u0435\u0442 \u043f\u0440\u0438\u043c\u0435\u0440: \u0433\u043e\u0442\u043e\u0432\u044b\u0439 \u0442\u0435\u043a\u0441\u0442 \u043e\u0441\u0442\u0430\u0451\u0442\u0441\u044f \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442\u0435\u043b\u044c\u043d\u043e \u043f\u0440\u0435\u0436\u043d\u0438\u043c, \u043d\u043e \u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0441\u044f \u0443\u0434\u043e\u0431\u043d\u0435\u0435 \u0434\u043b\u044f \u0447\u0442\u0435\u043d\u0438\u044f \u0432 Telegram."
].join("\n\n");

export function buildProductionShapeFixture({ accountId, now }) {
  if (!/^[1-9][0-9]*$/.test(accountId)) throw new Error("invalid_fixture_account");
  const planSlice = { index: 1, topic: "Synthetic", angle: "Neutral", includes: ["Seven segments"] };
  const selectedPlan = { optionId: "production_shape_fixture", postCount: 1, title: "Synthetic", angle: "Neutral", summary: "Deterministic", posts: [planSlice] };
  return { id: randomUUID(), telegramUserId: accountId, chatId: accountId, state: "draft_editing", isActive: true, transcript: canonicalDraft, selectedPlan, rewriteMode: "clean_up", posts: [{ id: randomUUID(), index: 1, planSlice, currentDraft: canonicalDraft, draftVersion: 1 }], currentPostIndex: 1, messages: [{ kind: "command", text: productionShapeFixtureMarker, createdAt: now }], createdAt: now, updatedAt: now };
}
export function cleanupScopeMatches(a, b) { return Boolean(a?.fixtureId && a?.marker && a?.accountId && a?.priorActiveProjectId && a.fixtureId===b?.fixtureId && a.marker===b?.marker && a.accountId===b?.accountId && a.priorActiveProjectId===b?.priorActiveProjectId); }
export function prepareFixtureLifecycle(input) {
  return {
    async create(now=new Date()) {
      const prior=await input.findActive(input.accountId); if(!prior?.id||!prior.isActive) throw new Error("prior_active_project_missing");
      const fixture=buildProductionShapeFixture({accountId:input.accountId,now});
      const state={fixtureId:fixture.id,projectId:fixture.id,accountId:input.accountId,marker:productionShapeFixtureMarker,priorActiveProjectId:prior.id};
      await input.transaction(async(scope)=>{await scope.suspendPrior(prior.id);await scope.saveFixture(fixture);});
      try{await input.writePrivateState(state);}catch(error){await input.transaction(async(scope)=>{await scope.deleteFixture(fixture.id);await scope.restorePrior(prior.id);});throw error;}
      return state;
    },
    async cleanup(state) {
      if(!cleanupScopeMatches(state,state)||state.marker!==productionShapeFixtureMarker||state.accountId!==input.accountId) throw new Error("fixture_cleanup_scope_invalid");
      await input.transaction(async(scope)=>{await scope.deleteFixture(state.fixtureId);await scope.restorePrior(state.priorActiveProjectId);});
      await input.removePrivateState();
    }
  };
}
async function main(){
  const action=process.argv[2],databaseUrl=required("DATABASE_URL"),accountId=requiredAccount("TG_POST_AGENT_PRODUCTION_SHAPE_ACCOUNT_ID");
  if(!databaseUrl.includes("tg_post_agent")||databaseUrl.includes("tg_post_agent_test"))throw new Error("unsafe_database_target");
  const pool=createDbPool({databaseUrl}),db=createDb(pool),projects=new PgProjectRepository(db),jobs=new PgJobRepository(db),lifecycle=productionLifecycle({db,projects,accountId});
  try{
    if(action==="create"){
      const collision=rowsOf(await db.execute(sql`select count(*)::int as count from projects p join users u on u.id=p.user_id join project_messages m on m.project_id=p.id where u.telegram_user_id=${BigInt(accountId)} and m.kind='command' and m.text=${productionShapeFixtureMarker}`))[0]?.count??0;
      if(Number(collision)!==0)throw new Error("fixture_marker_collision");
      const state=await lifecycle.create();
      console.log(JSON.stringify({fixtureCreated:true,markerOwned:true,recipientMatched:true,state:"draft_editing",segmentCount:7,longForm:true,cleanupArmed:Boolean(state.priorActiveProjectId)}));
    }else if(action==="enqueue_format_option2"){
      const state=await loadState();assertState(state,accountId);const fixture=await projects.findById(state.fixtureId),post=fixture?.posts.find(x=>x.index===fixture.currentPostIndex);
      const active=rowsOf(await db.execute(sql`select count(*)::int as count from jobs where project_id=${state.fixtureId} and type='FORMAT_POST' and status in ('queued','running','retry_scheduled')`))[0]?.count??0;
      const result=await prepareHeldOption2({projects,jobs,fixture,accountId,fixtureMarker:productionShapeFixtureMarker,expectedDraftVersion:post?.draftVersion,activeFormatJobCount:Number(active),writePrivateState:v=>atomicPrivateState(productionShapeFormatStatePath,v),cancelExactJob:async(job,current)=>{await db.execute(sql`update jobs set status='cancelled',finished_at=now(),updated_at=now() where id=${job.id} and project_id=${current.id} and dedupe_key=${"fixture:"+current.id+":format:option_2"} and status in ('queued','retry_scheduled')`);}});
      console.log(JSON.stringify({fixtureResolved:true,markerOwned:true,jobEnqueued:Boolean(result.job),jobType:"FORMAT_POST",formattingOption:"option_2",maxAttempts:1,held:true,segmentCount:7}));
    }else if(action==="cleanup"){
      const state=await loadState();assertState(state,accountId);await lifecycle.cleanup(state);
      try{const f=JSON.parse(await readFile(productionShapeFormatStatePath,"utf8"));if(f.marker!==productionShapeFixtureMarker||f.projectId!==state.fixtureId)throw new Error("format_state_scope_invalid");await unlink(productionShapeFormatStatePath);}catch(error){if(error?.code!=="ENOENT")throw error;}
      console.log(JSON.stringify({fixtureCleaned:true,priorActiveRestored:true}));
    }else throw new Error("unsupported_action");
  }finally{await pool.end();}
}
function productionLifecycle({db,projects,accountId}){return prepareFixtureLifecycle({accountId,findActive:user=>projects.findActiveByTelegramUser(user),transaction:work=>db.transaction(async tx=>{const scoped=new PgProjectRepository(tx);return work({suspendPrior:async id=>{const r=await tx.execute(sql`update projects set is_active=false where id=${id} and user_id=(select id from users where telegram_user_id=${BigInt(accountId)}) and is_active=true`);if(rowCount(r)!==1)throw new Error("prior_suspend_failed");},saveFixture:f=>scoped.save(f),deleteFixture:async id=>{const r=await tx.execute(sql`delete from projects where id=${id} and user_id=(select id from users where telegram_user_id=${BigInt(accountId)}) and exists(select 1 from project_messages m where m.project_id=projects.id and m.kind='command' and m.text=${productionShapeFixtureMarker})`);if(rowCount(r)!==1)throw new Error("fixture_delete_failed");},restorePrior:async id=>{const r=await tx.execute(sql`update projects set is_active=true where id=${id} and user_id=(select id from users where telegram_user_id=${BigInt(accountId)}) and is_active=false`);if(rowCount(r)!==1)throw new Error("prior_restore_failed");}});}),writePrivateState:s=>atomicPrivateState(productionShapeFixtureStatePath,s),removePrivateState:()=>unlink(productionShapeFixtureStatePath)});}
async function loadState(){return JSON.parse(await readFile(productionShapeFixtureStatePath,"utf8"));}
function assertState(s,a){if(s?.marker!==productionShapeFixtureMarker||s?.accountId!==a||s?.fixtureId!==s?.projectId||!s?.priorActiveProjectId)throw new Error("fixture_state_invalid");}
function rowsOf(r){return Array.isArray(r?.rows)?r.rows:[];}function rowCount(r){return Number(r?.rowCount??0);}function required(n){const v=process.env[n]?.trim();if(!v)throw new Error("configuration");return v;}function requiredAccount(n){const v=required(n);if(!/^[1-9][0-9]*$/.test(v))throw new Error("configuration");return v;}
if(import.meta.url===new URL(process.argv[1],"file:").href)await main();
