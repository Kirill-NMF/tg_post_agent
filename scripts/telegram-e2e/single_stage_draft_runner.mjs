import { writeFile } from "node:fs/promises";
import { createDb, createDbPool } from "../../dist/src/db/connection.js";
import { PgProjectRepository } from "../../dist/src/repositories/pgProjectRepository.js";
import { PgJobRepository } from "../../dist/src/repositories/pgJobRepository.js";
import { JobWorker } from "../../dist/src/services/jobWorker.js";
import { createAudioPipelineHandlers } from "../../dist/src/services/audioPipelineFactory.js";
import { loadConfig } from "../../dist/src/config/env.js";

export function guardedJob(jobs, projectId) {
 const matching=jobs.filter(j=>j.projectId===projectId&&j.type==="GENERATE_DRAFT"&&j.status==="queued");
 return matching.length===1&&jobs.filter(j=>j.status==="queued").length===1 ? matching[0] : undefined;
}
async function main(){
 const marker=process.env.TG_POST_AGENT_FIXTURE_FINGERPRINT,report=process.env.TG_POST_AGENT_SINGLE_STAGE_REPORT;
 if(!marker||!report)throw Error("configuration");
 const config=loadConfig({...process.env,PROVIDER_FALLBACKS_ENABLED:"false",DRAFT_GENERATION_JOB_MAX_ATTEMPTS:"1"});
 const pool=createDbPool({databaseUrl:config.databaseUrl});const db=createDb(pool);const projects=new PgProjectRepository(db),jobs=new PgJobRepository(db);
 const r={markerFingerprint:marker,processed:false,category:null,providerBound:1};
 try{const active=await projects.findActiveByTelegramUser(process.env.TG_POST_AGENT_CORRECTION_CANARY_ACCOUNT_ID);if(!active||!active.messages.some(m=>m.kind==="command"&&m.text.includes("tier2-correction")))throw Error("fixture_invalid");const candidates=[];for(;;){const j=await jobs.claimNextDue({workerId:"single-stage-probe"});if(!j)break;candidates.push(j);break;}const job=guardedJob(candidates,active.id);if(!job)throw Error("job_scope_invalid");const h=createAudioPipelineHandlers({config,projects,jobs});const out=await new JobWorker(jobs,{GENERATE_DRAFT:h.GENERATE_DRAFT}).processOne({workerId:"single-stage-runner"});r.processed=out.processed;r.category=out.processed?out.status:"no_job";}catch(e){r.category=e instanceof Error?e.message:"runner_failure";}finally{await pool.end();const t=report+".tmp";await writeFile(t,JSON.stringify(r));await writeFile(report,JSON.stringify(r));}console.log(JSON.stringify(r));}
if(import.meta.url===new URL(process.argv[1],"file:").href)await main();
