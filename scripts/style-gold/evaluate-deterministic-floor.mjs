import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseOption2SegmentPlan } from "../../dist/src/adapters/openRouterFormattingAdapter.js";
import { applySegmentFormattingPlan, deriveCanonicalSegments } from "../../dist/src/domain/formatting.js";
import { evaluateManusStyle } from "../../dist/src/evaluation/manusStyleEvaluator.js";
import { validatePrivateBenchmarkSelection } from "../../dist/src/evaluation/manusBenchmarkPolicy.js";

const tuningGoldIds = ["primary_option2_final", "generalization_7", "generalization_9"];
const root = resolve(process.cwd(), ".runtime/manus-style");
const results = [];

for (const goldId of tuningGoldIds) {
  const selection = validatePrivateBenchmarkSelection({ mode: "tuning", goldId, candidateId: `deterministic_floor_${goldId}` });
  if (!selection.ok || selection.holdout) exitSafely(selection.ok ? "MANUS_FLOOR_HOLDOUT_FORBIDDEN" : selection.code);
  const corpusPath = resolve(root, "corpus", `${selection.goldId}.json`);
  if (!corpusPath.startsWith(root)) exitSafely("MANUS_BENCHMARK_PATH_INVALID");
  await requirePrivateFile(corpusPath);
  const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
  if (typeof corpus.formattedText !== "string" || typeof corpus.plainText !== "string") exitSafely("MANUS_PRIVATE_CORPUS_INVALID");

  const segments = deriveCanonicalSegments(corpus.plainText);
  const intro = segments.find((segment) => segment.role === "intro");
  if (!intro) exitSafely("MANUS_FLOOR_INTRO_ROLE_ABSENT");
  const directives = parseOption2SegmentPlan(JSON.stringify({
    primaryEmoji: { id: intro.id, kind: "emoji_insertion", position: "before", emoji: "📜" },
    operations: [],
  }), segments, 30);
  const rendered = applySegmentFormattingPlan(corpus.plainText, "option_2", directives, segments);
  if (!rendered.ok) exitSafely(rendered.code);
  const evaluation = evaluateManusStyle(corpus.plainText, corpus.formattedText, rendered.text, 0.65);
  results.push({
    goldId: selection.goldId,
    holdout: false,
    segmentCount: segments.length,
    directiveCount: directives.length,
    hardGates: evaluation.hardGates,
    metrics: evaluation.metrics,
    weightedStyleScore: evaluation.weightedStyleScore,
    thresholdPassed: evaluation.weightedStyleScore >= 0.65,
    category: evaluation.pass ? "MANUS_DETERMINISTIC_FLOOR_PASS" : "MANUS_DETERMINISTIC_FLOOR_BELOW_THRESHOLD",
  });
}

process.stdout.write(JSON.stringify({
  providerCalled: false,
  holdoutRead: false,
  tuningGoldCount: results.length,
  results,
}) + "\n");

async function requirePrivateFile(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) exitSafely("MANUS_CORPUS_PERMISSIONS_INVALID");
}

function exitSafely(category) {
  process.stdout.write(JSON.stringify({ providerCalled: false, holdoutRead: false, category }) + "\n");
  process.exit(2);
}
