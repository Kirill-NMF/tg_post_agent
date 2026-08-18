import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { OpenRouterFormattingAdapter } from "../../dist/src/adapters/openRouterFormattingAdapter.js";
import { createOpenRouterInteractionClient } from "../../dist/src/adapters/openRouterInteractionClient.js";
import { applySegmentFormattingPlan, deriveCanonicalSegments, recoverCanonicalText } from "../../dist/src/domain/formatting.js";
import { deformatGold } from "../../dist/src/evaluation/manusStyleEvaluator.js";
import { validatePrivateBenchmarkSelection } from "../../dist/src/evaluation/manusBenchmarkPolicy.js";

const privateRoot = resolve(process.cwd(), ".runtime/manus-style");
const manifestPath = resolve(process.cwd(), "docs/evidence/manus-style-gold-manifest.json");
const primaryPassGatePath = resolve(privateRoot, "reports/primary-pass-gate.json");

export function validateBenchmarkPreflight(input) {
  const manifestGold = input.manifest?.documents?.find((item) => item.id === input.goldId);
  if (input.mode === "tuning") {
    if (input.goldId === input.manifest?.holdout || manifestGold?.holdout) return "MANUS_HOLDOUT_TUNING_FORBIDDEN";
    if (!manifestGold || input.goldId !== "primary_option2_final") return "MANUS_TUNING_GOLD_ID_INVALID";
  } else if (input.mode === "holdout") {
    if (!manifestGold?.holdout || input.goldId !== input.manifest?.holdout) return "MANUS_HOLDOUT_ID_REQUIRED";
    if (!isValidPrimaryPassGate(input.primaryPassGate, input.expectedPrimaryCandidateId)) return "MANUS_PRIMARY_PASS_GATE_REQUIRED";
  } else {
    return "MANUS_BENCHMARK_MODE_INVALID";
  }
  if (manifestGold.sha256 !== input.formattedHash) return "MANUS_GOLD_HASH_MISMATCH";
  if (!input.corpusPrivate || !input.outputPrivate) return "MANUS_PRIVATE_PERMISSIONS_INVALID";
  if (!input.apiKeyPresent) return "MANUS_PROVIDER_KEY_ABSENT";
  if (input.model !== "anthropic/claude-sonnet-5") return "MANUS_PROVIDER_MODEL_MISMATCH";
  const ledger = input.ledger;
  if (!Number.isSafeInteger(input.expectedLedgerCap) || input.expectedLedgerCap < 1 || !Number.isSafeInteger(input.expectedLedgerSpent) || input.expectedLedgerSpent < 0 || input.expectedLedgerSpent >= input.expectedLedgerCap) return "MANUS_LEDGER_PRECONDITION_FAILED";
  if (!ledger || ledger.dailyBudget !== input.expectedLedgerCap || ledger.attemptedBillableOperations !== input.expectedLedgerSpent || ledger.remainingBudget !== input.expectedLedgerCap - input.expectedLedgerSpent || !Array.isArray(ledger.entries)) return "MANUS_LEDGER_PRECONDITION_FAILED";
  return null;
}

export function validateTuningPreflight(input) {
  return validateBenchmarkPreflight({ ...input, mode: "tuning", expectedLedgerCap: input.expectedLedgerCap ?? 50, primaryPassGate: null, expectedPrimaryCandidateId: null });
}

function isValidPrimaryPassGate(gate, expectedCandidateId) {
  return Boolean(gate)
    && gate.goldId === "primary_option2_final"
    && gate.candidateId === expectedCandidateId
    && gate.pass === true
    && gate.threshold === 0.65
    && gate.holdoutUnlocked === true;
}

export function createLedgeredSingleAttemptClient(input) {
  return {
    attemptedProviderCalls: 0,
    async create(request) {
      if (this.attemptedProviderCalls !== 0) throw new Error("MANUS_PROVIDER_ATTEMPT_LIMIT");
      await input.reserve();
      this.attemptedProviderCalls = 1;
      let response;
      try {
        response = await input.client.create(request);
      } catch (error) {
        await input.complete("provider_failure");
        throw error;
      }
      await input.complete("provider_success");
      return response;
    },
  };
}

export function createSafeDiagnosticsLogger() {
  let latest = {};
  return {
    logger: {
      info() {},
      warn(fields) {
        if (fields?.event !== "formatting_segment_request_failed") return;
        latest = compact({
          failureBoundary: safeEnum(fields.failureBoundary, ["formatting_plan_validation", "provider_response", "provider_transport", "unknown"]),
          validationCode: safeCode(fields.validationCode),
          errorCode: safeCode(fields.errorCode),
          errorName: safeName(fields.errorName),
          responseEndpoint: safeEnum(fields.responseEndpoint, ["openrouter_chat_completions"]),
          responseStatusClass: safeEnum(fields.responseStatusClass, ["2xx", "3xx", "4xx", "5xx", "unknown"]),
          responseContentType: safeEnum(fields.responseContentType, ["json", "html", "text", "other", "missing"]),
          responseByteLengthBucket: safeByteBucket(fields.responseByteLengthBucket, fields.responseByteLength),
          planValidationStage: safeEnum(fields.planValidationStage, ["json", "shape", "semantic"]),
          schemaFailureLocation: safeEnum(fields.schemaFailureLocation, ["not_applicable", "root", "primary_emoji", "operation"]),
          failingOperationIndexBucket: safeEnum(fields.failingOperationIndexBucket, ["not_applicable", "0", "1_3", "4_7", "8_15", "16_plus"]),
          failingOperationKind: safeEnum(fields.failingOperationKind, ["not_applicable", "missing", "paragraph_break", "markdown_span", "emoji_insertion", "semantic_accent", "heading_case", "list_marker", "unknown"]),
          fieldPresenceMask: safeInteger(fields.fieldPresenceMask, 0, 127),
          parsedOperationCount: safeInteger(fields.parsedOperationCount, 0, 1000),
          anyEmojiDirective: typeof fields.anyEmojiDirective === "boolean" ? fields.anyEmojiDirective : undefined,
        });
      },
      error() {},
    },
    snapshot: () => ({ ...latest }),
  };
}

export async function atomicPrivateWrite(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + ".tmp-" + process.pid;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, path);
}

async function main() {
  const args = new Map(process.argv.slice(2).map((item) => {
    const [key, ...parts] = item.split("=");
    return [key, parts.join("=")];
  }));
  const goldId = args.get("--gold-id") ?? "";
  const candidateId = args.get("--candidate-id") ?? "";
  const runId = args.get("--run-id") ?? "";
  const mode = args.get("--mode") ?? "tuning";
  const expectedPrimaryCandidateId = args.get("--primary-candidate-id") ?? null;
  const preflightOnly = args.get("--preflight-only") === "true";
  const expectedLedgerSpent = Number(process.env.TG_POST_AGENT_EXPECTED_LEDGER_SPENT);
  const expectedLedgerCap = Number(process.env.TG_POST_AGENT_EXPECTED_LEDGER_CAP);
  const selection = validatePrivateBenchmarkSelection({ mode, goldId, candidateId });
  if (!selection.ok || !/^[a-z0-9][a-z0-9_-]{2,63}$/u.test(runId)) return emitFailure(selection.ok ? "MANUS_RUN_ID_INVALID" : selection.code, undefined);

  const corpusPath = resolve(privateRoot, "corpus", goldId + ".json");
  const candidatePath = resolve(privateRoot, "candidates", candidateId + ".txt");
  const reportPath = resolve(privateRoot, "reports", runId + ".json");
  const ledgerPath = process.env.TG_POST_AGENT_BILLABLE_LEDGER_PATH;
  let ledgeredClient;
  let report = baseReport();
  try {
    if (!ledgerPath || !isInsidePrivateRoot(candidatePath) || !isInsidePrivateRoot(reportPath)) throw safeError("MANUS_PATH_CONFIGURATION_INVALID");
    let primaryPassGate = null;
    if (selection.holdout) {
      await requirePrivateFile(primaryPassGatePath);
      primaryPassGate = JSON.parse(await readFile(primaryPassGatePath, "utf8"));
    }
    await requirePrivateFile(corpusPath);
    await requireAbsent(candidatePath);
    await requireAbsent(reportPath);
    await mkdir(resolve(privateRoot, "candidates"), { recursive: true, mode: 0o700 });
    await mkdir(resolve(privateRoot, "reports"), { recursive: true, mode: 0o700 });
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    if (typeof corpus.formattedText !== "string" || typeof corpus.plainText !== "string") throw safeError("MANUS_PRIVATE_CORPUS_INVALID");
    const deterministic = deformatGold(corpus.formattedText);
    if (deterministic.plainText !== corpus.plainText) throw safeError("MANUS_DEFORMAT_HASH_MISMATCH");
    const preflightCategory = validateBenchmarkPreflight({
      mode: selection.mode,
      goldId,
      manifest,
      formattedHash: sha256(corpus.formattedText),
      corpusPrivate: await isPrivateFile(corpusPath),
      outputPrivate: await allPrivateDirectories([
        privateRoot,
        resolve(privateRoot, "candidates"),
        resolve(privateRoot, "reports"),
      ]),
      ledger,
      expectedLedgerSpent,
      expectedLedgerCap,
      model: process.env.OPENROUTER_FORMATTING_MODEL,
      apiKeyPresent: Boolean(process.env.OPENROUTER_API_KEY),
      primaryPassGate,
      expectedPrimaryCandidateId,
    });
    if (preflightCategory) throw safeError(preflightCategory);
    const segments = deriveCanonicalSegments(corpus.plainText);
    if (segments.length < 7) throw safeError("MANUS_PRODUCTION_SHAPE_TOO_SMALL");
    if (preflightOnly) {
      report = {
        ...report,
        terminalCategory: "preflight_ready",
        benchmarkMode: selection.mode,
        holdout: selection.holdout,
        segmentCount: segments.length,
        corpusHashMatched: true,
        structuredOutputContract: true,
        fallbackUsed: false,
        providerAttemptCount: 0,
        ledgerSpent: ledger.attemptedBillableOperations,
        ledgerCap: ledger.dailyBudget,
      };
      await atomicPrivateWrite(reportPath, JSON.stringify(report) + "\n");
      process.stdout.write(JSON.stringify(report) + "\n");
      return;
    }

    const reserve = () => appendLedgerEvent(ledgerPath, {
      expectedSpent: expectedLedgerSpent,
      expectedCap: expectedLedgerCap,
      billable: true,
      category: selection.holdout ? "manus_holdout_final" : "manus_tuning_primary",
      outcome: "started",
    });
    const complete = (outcome) => appendLedgerEvent(ledgerPath, {
      expectedSpent: expectedLedgerSpent + 1,
      expectedCap: expectedLedgerCap,
      billable: false,
      category: selection.holdout ? "manus_holdout_final_terminal" : "manus_tuning_primary_terminal",
      outcome,
    });
    ledgeredClient = createLedgeredSingleAttemptClient({
      client: createOpenRouterInteractionClient({
        apiKey: process.env.OPENROUTER_API_KEY,
        requestTimeoutMs: Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS || 60000),
        providerRoute: { order: ["anthropic"], allow_fallbacks: false },
      }),
      reserve,
      complete,
    });
    const diagnostics = createSafeDiagnosticsLogger();
    const adapter = new OpenRouterFormattingAdapter({
      client: ledgeredClient,
      model: process.env.OPENROUTER_FORMATTING_MODEL,
      logger: diagnostics.logger,
    });
    const providerResult = await adapter.formatOption2Segments({
      projectId: selection.holdout ? "private-manus-holdout" : "private-manus-tuning-primary",
      draftText: corpus.plainText,
      segments,
    });
    report.providerAttemptCount = ledgeredClient.attemptedProviderCalls;
    if (!providerResult.ok) {
      report.adapterDiagnostics = diagnostics.snapshot();
      throw safeError(report.adapterDiagnostics.validationCode ?? report.adapterDiagnostics.errorCode ?? providerResult.error.code);
    }
    report.shapeGate = "valid";
    report.semanticGate = "valid";
    const rendered = applySegmentFormattingPlan(corpus.plainText, "option_2", providerResult.value.directives, segments);
    if (!rendered.ok) throw safeError(rendered.code);
    if (recoverCanonicalText(rendered.text, rendered.insertions, rendered.caseTransforms) !== corpus.plainText) throw safeError("FORMAT_LEXICAL_PRESERVATION_FAILED");
    await atomicPrivateWrite(candidatePath, rendered.text);
    report = {
      ...report,
      terminalCategory: "candidate_rendered",
      benchmarkMode: selection.mode,
      holdout: selection.holdout,
      candidateWritten: true,
      segmentCount: segments.length,
      operationCount: providerResult.value.directives.length,
      lexicalPreserved: true,
      punctuationPreserved: true,
      providerAttemptCount: ledgeredClient.attemptedProviderCalls,
      retryCount: 0,
      fallbackUsed: false,
      routeCategory: "openrouter_anthropic",
      modelCategory: "claude_sonnet",
      schemaCategory: "shared_strict_json_schema",
      candidateFingerprint: sha256(rendered.text).slice(0, 16),
    };
  } catch (error) {
    report.providerAttemptCount = ledgeredClient?.attemptedProviderCalls ?? 0;
    report.terminalCategory = safeCategory(error);
  }
  const ledgerAfter = await readLedgerSummary(ledgerPath);
  report.ledgerSpent = ledgerAfter?.attemptedBillableOperations;
  report.ledgerCap = ledgerAfter?.dailyBudget;
  await atomicPrivateWrite(reportPath, JSON.stringify(report) + "\n");
  process.stdout.write(JSON.stringify(report) + "\n");
  process.exitCode = report.candidateWritten ? 0 : 2;
}

function baseReport() {
  return {
    terminalCategory: "preflight_not_started",
    candidateWritten: false,
    shapeGate: "not_reached",
    semanticGate: "not_reached",
    lexicalPreserved: false,
    punctuationPreserved: false,
    providerAttemptCount: 0,
    retryCount: 0,
    fallbackUsed: false,
  };
}

export async function appendLedgerEvent(path, event) {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw safeError("MANUS_LEDGER_PERMISSIONS_INVALID");
  const ledger = JSON.parse(await readFile(path, "utf8"));
  if (ledger.dailyBudget !== event.expectedCap || ledger.attemptedBillableOperations !== event.expectedSpent || ledger.remainingBudget !== event.expectedCap - event.expectedSpent || !Array.isArray(ledger.entries)) throw safeError("MANUS_LEDGER_CHANGED");
  const next = {
    ...ledger,
    attemptedBillableOperations: ledger.attemptedBillableOperations + (event.billable ? 1 : 0),
    remainingBudget: ledger.remainingBudget - (event.billable ? 1 : 0),
    entries: [...ledger.entries, { billable: event.billable, category: event.category, outcome: event.outcome }],
  };
  await atomicPrivateWrite(path, JSON.stringify(next, null, 2) + "\n");
}

export async function readLedgerSummary(path) {
  if (!path) return undefined;
  try {
    const ledger = JSON.parse(await readFile(path, "utf8"));
    return { dailyBudget: ledger.dailyBudget, attemptedBillableOperations: ledger.attemptedBillableOperations };
  } catch {
    return undefined;
  }
}

async function requirePrivateFile(path) {
  if (!await isPrivateFile(path)) throw safeError("MANUS_PRIVATE_PERMISSIONS_INVALID");
}

async function isPrivateFile(path) {
  try {
    const metadata = await stat(path);
    return metadata.isFile() && (metadata.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

async function isPrivateDirectory(path) {
  try {
    const metadata = await stat(path);
    return metadata.isDirectory() && (metadata.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

async function allPrivateDirectories(paths) {
  const results = await Promise.all(paths.map(isPrivateDirectory));
  return results.every(Boolean);
}

async function requireAbsent(path) {
  try {
    await stat(path);
    throw safeError("MANUS_RUN_ARTIFACT_COLLISION");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
}

function isInsidePrivateRoot(path) {
  return path === privateRoot || path.startsWith(privateRoot + "/");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeError(code) {
  const error = new Error(code);
  error.safeCode = code;
  return error;
}

function safeCategory(error) {
  if (error && typeof error === "object" && typeof error.safeCode === "string" && /^[A-Z0-9_]{3,80}$/u.test(error.safeCode)) return error.safeCode;
  return "MANUS_BENCHMARK_RUNNER_FAILURE";
}

function compact(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function safeEnum(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : undefined;
}

function safeCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,79}$/u.test(value) ? value : undefined;
}

function safeName(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(value) ? value : undefined;
}

function safeInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined;
}

function safeByteBucket(existing, raw) {
  const allowed = ["empty", "1_127", "128_255", "256_1023", "1024_4095", "4096_plus"];
  if (typeof existing === "string" && allowed.includes(existing)) return existing;
  if (!Number.isSafeInteger(raw) || raw < 0) return undefined;
  if (raw === 0) return "empty";
  if (raw <= 127) return "1_127";
  if (raw <= 255) return "128_255";
  if (raw <= 1023) return "256_1023";
  if (raw <= 4095) return "1024_4095";
  return "4096_plus";
}

function emitFailure(category, reportPath) {
  const report = { ...baseReport(), terminalCategory: category, ledgerSpent: undefined, ledgerCap: undefined };
  if (reportPath) void atomicPrivateWrite(reportPath, JSON.stringify(report) + "\n");
  process.stdout.write(JSON.stringify(report) + "\n");
  process.exitCode = 2;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) await main();
