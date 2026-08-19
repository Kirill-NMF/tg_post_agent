import type { FormattingOption, ProjectId, RewriteMode } from "../domain/types.js";

export type BoundArtifactAction =
  | { projectId: ProjectId; kind: "plan"; optionIndex: number }
  | { projectId: ProjectId; kind: "open_format"; postIndex: number; draftVersion: number }
  | { projectId: ProjectId; kind: "rerun"; postIndex: number; draftVersion: number; rewriteMode: RewriteMode }
  | { projectId: ProjectId; kind: "format"; postIndex: number; draftVersion: number; formattingOption: FormattingOption }
  | { projectId: ProjectId; kind: "done"; postIndex: number; formattedVersion: number };

export const bindPlan = (projectId: ProjectId, optionIndex: number) => encode(projectId, `p:${optionIndex}`);
export const bindOpenFormat = (projectId: ProjectId, postIndex: number, draftVersion: number) => encode(projectId, `o:${postIndex}:${draftVersion}`);
export const bindRerun = (projectId: ProjectId, postIndex: number, draftVersion: number, mode: RewriteMode) => encode(projectId, `r:${mode === "clean_up" ? "c" : "m"}:${postIndex}:${draftVersion}`);
export const bindFormat = (projectId: ProjectId, postIndex: number, draftVersion: number, option: FormattingOption) => encode(projectId, `f:${option === "option_1" ? "1" : "2"}:${postIndex}:${draftVersion}`);
export const bindDone = (projectId: ProjectId, postIndex: number, formattedVersion: number) => encode(projectId, `d:${postIndex}:${formattedVersion}`);
export const bindSourceProcess = (projectId: ProjectId) => encode(projectId, "s:0");
export const canBindArtifactProjectId = (projectId: string | undefined): projectId is ProjectId => Boolean(projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(projectId));

export function parseBoundArtifactAction(action: string): BoundArtifactAction | undefined {
  const match = /^a:([0-9a-f]{32}):([pordf]):(.+)$/u.exec(action);
  if (!match) return undefined;
  const projectId = expandUuid(match[1]!);
  const values = match[3]!.split(":");
  const numbers = values.map(Number);
  if (match[2] === "p" && valid(numbers[0])) return { projectId, kind: "plan", optionIndex: numbers[0]! };
  if (match[2] === "o" && valid(numbers[0], 1) && valid(numbers[1], 1)) return { projectId, kind: "open_format", postIndex: numbers[0]!, draftVersion: numbers[1]! };
  if (match[2] === "r" && (values[0] === "c" || values[0] === "m") && valid(numbers[1], 1) && valid(numbers[2], 1)) return { projectId, kind: "rerun", rewriteMode: values[0] === "c" ? "clean_up" : "make_post", postIndex: numbers[1]!, draftVersion: numbers[2]! };
  if (match[2] === "f" && (values[0] === "1" || values[0] === "2") && valid(numbers[1], 1) && valid(numbers[2], 1)) return { projectId, kind: "format", formattingOption: values[0] === "1" ? "option_1" : "option_2", postIndex: numbers[1]!, draftVersion: numbers[2]! };
  if (match[2] === "d" && valid(numbers[0], 1) && valid(numbers[1], 1)) return { projectId, kind: "done", postIndex: numbers[0]!, formattedVersion: numbers[1]! };
  return undefined;
}

export function parseSourceProcessAction(action: string): ProjectId | undefined {
  const match = /^a:([0-9a-f]{32}):s:0$/u.exec(action);
  return match ? expandUuid(match[1]!) : undefined;
}

function encode(projectId: ProjectId, suffix: string): string {
  if (!canBindArtifactProjectId(projectId)) throw new Error("ARTIFACT_PROJECT_ID_INVALID");
  const action = `a:${projectId.replaceAll("-", "").toLowerCase()}:${suffix}`;
  if (Buffer.byteLength(action, "utf8") > 64) throw new Error("ARTIFACT_CALLBACK_TOO_LONG");
  return action;
}
function expandUuid(value: string): ProjectId { return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`; }
function valid(value: number | undefined, minimum = 0): value is number { return Number.isSafeInteger(value) && value! >= minimum; }
