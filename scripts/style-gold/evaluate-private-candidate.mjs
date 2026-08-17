import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateManusStyle } from "../../dist/src/evaluation/manusStyleEvaluator.js";
import { validatePrivateBenchmarkSelection } from "../../dist/src/evaluation/manusBenchmarkPolicy.js";

const argumentsMap = new Map(process.argv.slice(2).map((item) => {
  const [key, ...value] = item.split("=");
  return [key, value.join("=")];
}));
const selection = validatePrivateBenchmarkSelection({
  mode: argumentsMap.get("--mode"),
  goldId: argumentsMap.get("--gold-id") ?? "",
  candidateId: argumentsMap.get("--candidate-id") ?? "",
});
if (!selection.ok) exitSafely(selection.code);

const root = resolve(process.cwd(), ".runtime/manus-style");
const corpusPath = resolve(root, "corpus", `${selection.goldId}.json`);
const candidatePath = resolve(root, "candidates", `${selection.candidateId}.txt`);
const diffPath = resolve(root, "diffs", `${selection.mode}-${selection.goldId}-${selection.candidateId}.private.json`);
if (!corpusPath.startsWith(root) || !candidatePath.startsWith(root) || !diffPath.startsWith(root)) exitSafely("MANUS_BENCHMARK_PATH_INVALID");

try {
  await requirePrivateFile(corpusPath);
  await requirePrivateFile(candidatePath);
  const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
  const candidate = await readFile(candidatePath, "utf8");
  if (typeof corpus.formattedText !== "string" || typeof corpus.plainText !== "string") exitSafely("MANUS_PRIVATE_CORPUS_INVALID");
  const evaluation = evaluateManusStyle(corpus.plainText, corpus.formattedText, candidate, 0.65);
  await atomicWrite(diffPath, JSON.stringify({ goldId: selection.goldId, candidateId: selection.candidateId, sourcePlain: corpus.plainText, gold: corpus.formattedText, candidate, evaluation }, null, 2), 0o600);
  process.stdout.write(JSON.stringify({
    mode: selection.mode,
    holdout: selection.holdout,
    pass: evaluation.pass,
    hardGates: evaluation.hardGates,
    metrics: evaluation.metrics,
    weightedStyleScore: evaluation.weightedStyleScore,
    categories: evaluation.categories,
    diagnostics: evaluation.diagnostics,
    privateDiffWritten: true,
  }) + "\n");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") exitSafely("MANUS_CANDIDATE_ARTIFACT_ABSENT");
  exitSafely("MANUS_BENCHMARK_READ_FAILED");
}

async function requirePrivateFile(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) exitSafely("MANUS_CANDIDATE_PERMISSIONS_INVALID");
}
async function atomicWrite(path, value, mode) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, value, { mode });
  await rename(temporary, path);
}
function exitSafely(code) {
  process.stdout.write(JSON.stringify({ pass: false, category: code, providerCalled: false, privateDiffWritten: false }) + "\n");
  process.exit(2);
}
