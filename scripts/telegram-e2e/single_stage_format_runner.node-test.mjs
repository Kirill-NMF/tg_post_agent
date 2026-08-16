import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryJobRepository } from "../../dist/src/repositories/inMemoryJobRepository.js";
import { atomicReport, controlledNowFromFormatState, formatExactPreflight, providerBoundaryReport, terminalEvidence } from "./single_stage_format_runner.mjs";

function sample(now = Date.now()) {
 const state={jobId:"job",projectId:"project",accountId:"account",marker:"marker",runAfter:new Date(now+60_000).toISOString(),draftVersion:2,formattingOption:"option_2"};
 const project={id:"project",telegramUserId:"account",state:"formatting",currentPostIndex:1,messages:[{kind:"command",text:"marker"}],posts:[{id:"post",index:1,currentDraft:"canonical",draftVersion:2}]};
 const job={id:"job",type:"FORMAT_POST",projectId:"project",postId:"post",status:"queued",maxAttempts:1,dedupeKey:"fixture:project:format:option_2",payload:{postIndex:1,formattingOption:"option_2"}};
 return {state,project,job};
}

test("future-held FORMAT_POST is eligible only at controlled time", () => {
 const {state,project,job}=sample(1000);
 assert.equal(controlledNowFromFormatState(state,1000)?.getTime(),61001);
 assert.equal(formatExactPreflight({state,project,job,wallNow:1000}),null);
 assert.equal(controlledNowFromFormatState(state,61000),undefined);
});

test("wrong state, version, option, and job scope refuse before provider", () => {
 const {state,project,job}=sample();
 assert.equal(formatExactPreflight({state,project:{...project,state:"draft_editing"},job}),"fixture_scope_invalid");
 assert.equal(formatExactPreflight({state:{...state,draftVersion:3},project,job}),"draft_version_invalid");
 assert.equal(formatExactPreflight({state:{...state,formattingOption:"option_1"},project,job}),"private_state_invalid");
 assert.equal(formatExactPreflight({state,project,job:{...job,projectId:"other"}}),"job_scope_invalid");
});

test("preflight scope excludes unrelated due job", () => {
 const {state,project,job}=sample();
 const unrelated={...job,id:"unrelated",projectId:"other",postId:"other",dedupeKey:"fixture:other:format:option_2"};
 assert.equal(formatExactPreflight({state,project,job}),null);
 assert.equal(formatExactPreflight({state,project,job:unrelated}),"draft_version_invalid");
});

test("provider attempt is recorded before processing and terminal evidence rejects false success", () => {
 assert.equal(providerBoundaryReport({providerAttempted:false}).providerAttempted,true);
 const {project}=sample();
 project.posts[0].currentDraft="Первый блок.\n\nВторой блок.";
 project.posts[0].formattedText="✨ Первый блок.\n\n**Второй блок.**";
 assert.deepEqual(terminalEvidence({job:{status:"succeeded",result:{notificationStatus:"sent"}},project,expectedVersion:2}),{
  jobSucceeded:true,
  finalState:false,
  formattedNonempty:true,
  draftVersionMatched:true,
  notificationSent:true,
  lexicalPreserved:true,
  lexicalUnitCount:4,
  permittedEmojiCount:1,
  decorationPresent:true
 });
});

test("terminal evidence rejects lexical mutation and zero emoji", () => {
 const {project}=sample();
 project.posts[0].currentDraft="Первый блок.";
 project.posts[0].formattedText="Первый текст.";
 const evidence=terminalEvidence({job:{status:"succeeded",result:{notificationStatus:"sent"}},project,expectedVersion:2});
 assert.equal(evidence.lexicalPreserved,false);
 assert.equal(evidence.permittedEmojiCount,0);
 assert.equal(evidence.decorationPresent,false);
});

test("report is atomically published", async () => {
 const dir=await mkdtemp(join(tmpdir(),"format-runner-")),path=join(dir,"report.json");
 await atomicReport(path,{category:"safe"}); assert.deepEqual(JSON.parse(await readFile(path,"utf8")),{category:"safe"});
 await rm(dir,{recursive:true});
});

test("normal claim cannot see held format job while exact controlled claim gets it without unrelated due work", async () => {
 const jobs=new InMemoryJobRepository(), now=new Date();
 const unrelated=await jobs.enqueue({type:"GENERATE_DRAFT",projectId:"other",payload:{},maxAttempts:1});
 const held=await jobs.enqueue({type:"FORMAT_POST",projectId:"project",postId:"post",payload:{postIndex:1,formattingOption:"option_2"},maxAttempts:1,runAfter:new Date(now.getTime()+900000)});
 const normal=await jobs.claimNextDue({workerId:"normal",now});
 assert.equal(normal?.id,unrelated.id);
 const exact=await jobs.claimDueById({jobId:held.id,workerId:"exact",now:new Date(now.getTime()+900001)});
 assert.equal(exact?.id,held.id);
});
