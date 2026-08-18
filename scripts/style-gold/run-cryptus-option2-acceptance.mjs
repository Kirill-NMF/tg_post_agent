import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { OpenRouterFormattingAdapter } from "../../dist/src/adapters/openRouterFormattingAdapter.js";
import { createOpenRouterInteractionClient } from "../../dist/src/adapters/openRouterInteractionClient.js";
import { validateCryptusOption2Candidate } from "../../dist/src/domain/cryptusOption2.js";
import {
  appendLedgerEvent,
  atomicPrivateWrite,
  createLedgeredSingleAttemptClient,
  readLedgerSummary,
} from "./run-private-tuning-candidate.mjs";

const acceptanceDraft = `### Ваша личная деревня «крепостных» для контента
У каждого уважающего себя предпринимателя должна быть своя деревня «крепостных». Именно так я вижу использование ИИ-агентов.
Вот конкретный пример. Недавно я создал себе ИИ-агента, который генерирует обложки для постов в стиле трэп-альбомов. А теперь давайте сравним затраты «до» и «после»:
Раньше: 5 дней работы и ~3000 рублей за одну обложку. Сейчас: 30 минут и 500 рублей.
С текстами история не менее крутая. Я могу просто надиктовать свои мысли, а ИИ перепишет их в стиле любого автора. В итоге за 40 минут я получаю мегасочный пост непревзойденного уровня, на который раньше ушёл бы целый день кропотливой работы.
Контент можно делать просто жирнющий, в разы быстрее и дешевле.
Почему бы этим не воспользоваться?`;

const privateRoot = resolve(process.cwd(), ".runtime/cryptus-option2");

export function validateAcceptancePreflight(input) {
  if (!input.apiKeyPresent) return "CRYPTUS_PROVIDER_KEY_ABSENT";
  if (input.model !== "anthropic/claude-sonnet-5") return "CRYPTUS_PROVIDER_MODEL_MISMATCH";
  if (!input.privateDirectoriesReady) return "CRYPTUS_PRIVATE_PERMISSIONS_INVALID";
  if (!Number.isSafeInteger(input.expectedSpent) || !Number.isSafeInteger(input.expectedCap) || input.expectedSpent < 0 || input.expectedSpent >= input.expectedCap) return "CRYPTUS_LEDGER_PRECONDITION_FAILED";
  if (!input.ledger || input.ledger.attemptedBillableOperations !== input.expectedSpent || input.ledger.dailyBudget !== input.expectedCap || input.ledger.remainingBudget !== input.expectedCap - input.expectedSpent) return "CRYPTUS_LEDGER_PRECONDITION_FAILED";
  return null;
}

async function main() {
  const args = new Map(process.argv.slice(2).map((item) => {
    const [key, ...parts] = item.split("=");
    return [key, parts.join("=")];
  }));
  const candidateId = args.get("--candidate-id") ?? "";
  const runId = args.get("--run-id") ?? "";
  const preflightOnly = args.get("--preflight-only") === "true";
  if (!safeId(candidateId) || !safeId(runId)) return emit({ terminalCategory: "CRYPTUS_RUN_ID_INVALID" });

  const candidatePath = resolve(privateRoot, "candidates", candidateId + ".txt");
  const reportPath = resolve(privateRoot, "reports", runId + ".json");
  const ledgerPath = process.env.TG_POST_AGENT_BILLABLE_LEDGER_PATH;
  const expectedSpent = Number(process.env.TG_POST_AGENT_EXPECTED_LEDGER_SPENT);
  const expectedCap = Number(process.env.TG_POST_AGENT_EXPECTED_LEDGER_CAP);
  let report = baseReport();
  let ledgeredClient;
  try {
    if (!ledgerPath || !candidatePath.startsWith(privateRoot) || !reportPath.startsWith(privateRoot)) throw safeError("CRYPTUS_PATH_CONFIGURATION_INVALID");
    await mkdir(resolve(privateRoot, "candidates"), { recursive: true, mode: 0o700 });
    await mkdir(resolve(privateRoot, "reports"), { recursive: true, mode: 0o700 });
    await requireAbsent(candidatePath);
    await requireAbsent(reportPath);
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    const preflightCategory = validateAcceptancePreflight({
      apiKeyPresent: Boolean(process.env.OPENROUTER_API_KEY),
      model: process.env.OPENROUTER_FORMATTING_MODEL,
      privateDirectoriesReady: await privateDirectoriesReady(),
      expectedSpent,
      expectedCap,
      ledger,
    });
    if (preflightCategory) throw safeError(preflightCategory);
    if (preflightOnly) {
      report = {
        ...report,
        terminalCategory: "preflight_ready",
        sourceFingerprint: fingerprint(acceptanceDraft),
        sourcePresent: true,
        providerAttemptCount: 0,
        fallbackUsed: false,
        maxAttempts: 1,
        ledgerSpent: ledger.attemptedBillableOperations,
        ledgerCap: ledger.dailyBudget,
      };
      await atomicPrivateWrite(reportPath, JSON.stringify(report) + "\n");
      return emit(report);
    }

    ledgeredClient = createLedgeredSingleAttemptClient({
      client: createOpenRouterInteractionClient({
        apiKey: process.env.OPENROUTER_API_KEY,
        requestTimeoutMs: Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS || 60000),
        providerRoute: { order: ["anthropic"], allow_fallbacks: false },
      }),
      reserve: () => appendLedgerEvent(ledgerPath, {
        expectedSpent,
        expectedCap,
        billable: true,
        category: "cryptus_option2_owner_acceptance",
        outcome: "started",
      }),
      complete: (outcome) => appendLedgerEvent(ledgerPath, {
        expectedSpent: expectedSpent + 1,
        expectedCap,
        billable: false,
        category: "cryptus_option2_owner_acceptance_terminal",
        outcome,
      }),
    });
    const capturingClient = {
      async create(request) {
        const response = await ledgeredClient.create(request);
        if (typeof response.output_text === "string") {
          await atomicPrivateWrite(candidatePath, response.output_text);
          report.privateCandidateWritten = true;
        }
        return response;
      },
    };
    const adapter = new OpenRouterFormattingAdapter({
      client: capturingClient,
      model: process.env.OPENROUTER_FORMATTING_MODEL,
    });
    const startedAt = Date.now();
    const result = await adapter.formatOption2FinalText({
      projectId: "private-cryptus-owner-acceptance",
      draftText: acceptanceDraft,
    });
    report.providerDurationMs = Math.max(0, Date.now() - startedAt);
    report.providerAttemptCount = ledgeredClient.attemptedProviderCalls;
    if (!result.ok) throw safeError(result.error.code);
    const validation = validateCryptusOption2Candidate(acceptanceDraft, result.value.formattedText);
    if (!validation.ok) throw safeError(validation.code);
    report = {
      ...report,
      terminalCategory: "candidate_validated",
      explicitContractPassed: true,
      lexicalSequenceExact: validation.lexicalSequenceExact,
      punctuationPreserved: validation.punctuationPreserved,
      titleValid: validation.titleValid,
      finalQuestionValid: validation.finalQuestionValid,
      comparisonListValid: validation.comparisonListValid,
      allowedEmojiOnly: validation.allowedEmojiOnly,
      markdownValid: validation.markdownValid,
      retryCount: 0,
      fallbackUsed: false,
      maxAttempts: 1,
      routeCategory: "openrouter_anthropic",
      modelCategory: "claude_sonnet",
      promptVersion: "cryptus_media_option2_v1",
      candidateFingerprint: fingerprint(result.value.formattedText),
    };
  } catch (error) {
    report.providerAttemptCount = ledgeredClient?.attemptedProviderCalls ?? 0;
    report.terminalCategory = safeCategory(error);
  }
  const ledger = await readLedgerSummary(ledgerPath);
  report.ledgerSpent = ledger?.attemptedBillableOperations;
  report.ledgerCap = ledger?.dailyBudget;
  await atomicPrivateWrite(reportPath, JSON.stringify(report) + "\n");
  emit(report);
  process.exitCode = report.explicitContractPassed ? 0 : 2;
}

function baseReport() {
  return {
    terminalCategory: "preflight_not_started",
    explicitContractPassed: false,
    privateCandidateWritten: false,
    providerAttemptCount: 0,
    retryCount: 0,
    fallbackUsed: false,
    maxAttempts: 1,
  };
}

async function privateDirectoriesReady() {
  for (const path of [privateRoot, resolve(privateRoot, "candidates"), resolve(privateRoot, "reports")]) {
    const metadata = await stat(path);
    if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0) return false;
  }
  return true;
}

async function requireAbsent(path) {
  try {
    await stat(path);
    throw safeError("CRYPTUS_PRIVATE_ARTIFACT_EXISTS");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function safeId(value) {
  return /^[a-z0-9][a-z0-9_-]{2,63}$/u.test(value);
}

function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeCategory(error) {
  return error && typeof error === "object" && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.code)
    ? error.code
    : "CRYPTUS_ACCEPTANCE_FAILED";
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function emit(report) {
  process.stdout.write(JSON.stringify(report) + "\n");
}

if (import.meta.url === new URL(process.argv[1], "file:").href) await main();
