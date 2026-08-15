import { rename, writeFile } from "node:fs/promises";
import { createDb, createDbPool } from "../../dist/src/db/connection.js";
import { PgProjectRepository } from "../../dist/src/repositories/pgProjectRepository.js";
import { PgJobRepository } from "../../dist/src/repositories/pgJobRepository.js";
import { JobWorker } from "../../dist/src/services/jobWorker.js";
import { createAudioPipelineHandlers } from "../../dist/src/services/audioPipelineFactory.js";
import { loadConfig } from "../../dist/src/config/env.js";

export function exactPreflight({ project, job, markerFingerprint }) {
 if (!project || project.fixtureFingerprint !== markerFingerprint) return "marker_mismatch";
 if (!job || job.type !== "GENERATE_DRAFT" || job.projectId !== project.id || !["queued","retry_scheduled"].includes(job.status)) return "job_scope_invalid";
 return null;
}
export async function atomicReport(path, report) { const temp=path+".tmp"; await writeFile(temp,JSON.stringify(report)+"\n",{mode:0o600}); await rename(temp,path); }

async function main(){
 const markerFingerprint=process.env.TG_POST_AGENT_FIXTURE_FINGERPRINT,jobId=process.env.TG_POST_AGENT_EXPECTED_JOB_ID,reportPath=process.env.TG_POST_AGENT_SINGLE_STAGE_REPORT;
 if(!markerFingerprint||!jobId||!reportPath)throw Error("configuration");
 const config=loadConfig({...process.env,PROVIDER_FALLBACKS_ENABLED:"false",DRAFT_GENERATION_JOB_MAX_ATTEMPTS:"1"}); const pool=createDbPool({databaseUrl:config.databaseUrl}),db=createDb(pool),projects=new PgProjectRepository(db),jobs=new PgJobRepository(db);
 const report={markerFingerprint,processed:false,category:null,preflightMaxProviderAttempts:1,providerStarted:false};
 try { const fixture=await projects.findById(process.env.TG_POST_AGENT_FIXTURE_PROJECT_ID??""); const job=await jobs.findById(jobId); const category=exactPreflight({project:fixture?{id:fixture.id,fixtureFingerprint:fixture.messages.find(m=>m.kind==="command")?.text}:undefined,job,markerFingerprint}); if(category)throw Error(category); const handlers=createAudioPipelineHandlers({config,projects,jobs}); const result=await new JobWorker(jobs,{GENERATE_DRAFT:handlers.GENERATE_DRAFT}).processOne({workerId:"single-stage-runner",expectedJobId:jobId}); report.processed=result.processed;report.providerStarted=result.processed;report.category=result.processed?result.status:"no_job"; } catch(e){report.category=e instanceof Error?e.message:"runner_failure";} finally {await pool.end();await atomicReport(reportPath,report);} console.log(JSON.stringify(report));
}
if(import.meta.url===new URL(process.argv[1],"file:").href)await main();
