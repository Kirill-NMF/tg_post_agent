import test from "node:test";import assert from "node:assert/strict";import { guardedJob } from "./single_stage_draft_runner.mjs";
test("matching queued job is selected once",()=>{const j={projectId:"p",type:"GENERATE_DRAFT",status:"queued"};assert.equal(guardedJob([j],"p"),j);});
test("mismatched or extra job refuses before adapter",()=>{assert.equal(guardedJob([{projectId:"x",type:"GENERATE_DRAFT",status:"queued"}],"p"),undefined);assert.equal(guardedJob([{projectId:"p",type:"GENERATE_DRAFT",status:"queued"},{projectId:"p",type:"FORMAT_POST",status:"queued"}],"p"),undefined);});
