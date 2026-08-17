import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildStyleProfile,
  calibrateStyleThreshold,
  deformatGold,
  restoreGoldFormatting,
  tokenizeLexical,
} from "../../dist/src/evaluation/manusStyleEvaluator.js";

const root = resolve(process.cwd(), ".runtime/manus-style");
const sourceRoot = join(root, "source");
const corpusRoot = join(root, "corpus");
const diffRoot = join(root, "diffs");
const manifestPath = resolve(process.cwd(), "docs/evidence/manus-style-gold-manifest.json");
const reportPath = resolve(process.cwd(), "docs/evidence/manus-style-baseline.json");

const documents = [
  { id: "primary_option2_final", file: "telegram_formatted_option2_final_final.txt", authority: "primary_gold", holdout: false },
  { id: "generalization_7", file: "telegram_formatted_post_7.txt", authority: "generalization", holdout: false },
  { id: "generalization_9", file: "telegram_formatted_post_9.txt", authority: "generalization", holdout: false },
  { id: "holdout_10", file: "telegram_formatted_post_10.txt", authority: "holdout", holdout: true },
];

await mkdir(corpusRoot, { recursive: true, mode: 0o700 });
await mkdir(diffRoot, { recursive: true, mode: 0o700 });

const analyzed = [];
for (const document of documents) {
  const formattedText = await readFile(join(sourceRoot, document.file), "utf8");
  const deformatted = deformatGold(formattedText);
  const restored = restoreGoldFormatting(deformatted.plainText, deformatted.anchorMap);
  const idempotent = deformatGold(deformatted.plainText).plainText === deformatted.plainText;
  const lexicalEquivalent = lowered(deformatted.lexicalTokens).join("\u0000") === lowered(tokenizeLexical(formattedText)).join("\u0000");
  const profile = buildStyleProfile(formattedText);
  const roleCounts = Object.fromEntries(Object.keys(profile.roleDensity).map((role) => [role, deformatted.anchors.filter((anchor) => anchor.role === role).length]));
  const privateRecord = { ...document, formattedText, ...deformatted, profile };
  await atomicWrite(join(corpusRoot, `${document.id}.json`), JSON.stringify(privateRecord, null, 2), 0o600);
  await atomicWrite(join(diffRoot, `${document.id}.private-diff.json`), JSON.stringify({ formattedText, plainText: deformatted.plainText, anchorMap: deformatted.anchorMap }, null, 2), 0o600);
  analyzed.push({
    id: document.id,
    authority: document.authority,
    holdout: document.holdout,
    sha256: hash(formattedText),
    byteLength: Buffer.byteLength(formattedText),
    lexicalTokenCount: deformatted.lexicalTokens.length,
    anchorCount: deformatted.anchors.length,
    roleCounts,
    reversible: restored === formattedText,
    idempotent,
    lexicalEquivalent,
    profile,
  });
}

const training = analyzed.filter((item) => !item.holdout).map((item) => item.profile);
const calibration = calibrateStyleThreshold(training, "holdout_10");
const conflicts = [
  { code: "MAIN_HEADING_TREATMENT_VARIATION", primaryGoldFirst: true, evidence: "primary_full_bold_caps_holdout_distribution_differs" },
  { code: "PROMPT_CODE_DENSITY_VARIATION", primaryGoldFirst: true, evidence: "primary_sparse_holdout_dense" },
  { code: "INLINE_BOLD_DENSITY_VARIATION", primaryGoldFirst: true, evidence: "generalization_examples_exceed_primary" },
  { code: "SEMANTIC_ACCENT_SCOPE_VARIATION", primaryGoldFirst: true, evidence: "later_gold_refines_rule_evidence" },
  { code: "LIST_DASH_CONTEXT_VARIATION", primaryGoldFirst: true, evidence: "primary_and_generalization_context_dependent" },
];

await atomicWrite(manifestPath, JSON.stringify({
  schemaVersion: 1,
  privacy: "content_free_manifest_private_corpus_gitignored",
  authorityOrder: ["primary_gold", "generalization", "rule_evidence", "diagnostic_history"],
  holdout: "holdout_10",
  documents: analyzed.map(({ profile: _profile, ...item }) => item),
  ruleEvidence: [
    { id: "option2_rules_final", sha256: await fileHash(join(sourceRoot, "option2_rules_final.md")) },
    { id: "master_prompt_with_examples", sha256: await fileHash(join(sourceRoot, "master_prompt_with_examples.txt")) },
    { id: "cryptus_approved_emojis", sha256: await fileHash(join(sourceRoot, "cryptus_approved_emojis.txt")) },
  ],
  conflicts,
}, null, 2) + "\n", 0o644);

await atomicWrite(reportPath, JSON.stringify({
  schemaVersion: 1,
  corpusCount: analyzed.length,
  trainingCount: training.length,
  holdoutCount: 1,
  calibration,
  holdoutProfile: analyzed.find((item) => item.holdout)?.profile,
  hardGateSummary: {
    reversibleCount: analyzed.filter((item) => item.reversible).length,
    idempotentCount: analyzed.filter((item) => item.idempotent).length,
    lexicalEquivalentCount: analyzed.filter((item) => item.lexicalEquivalent).length,
  },
  conflictCodes: conflicts.map((item) => item.code),
  privateDiffArtifacts: analyzed.length,
}, null, 2) + "\n", 0o644);

process.stdout.write(JSON.stringify({
  corpusCount: analyzed.length,
  holdout: "holdout_10",
  reversibleCount: analyzed.filter((item) => item.reversible).length,
  idempotentCount: analyzed.filter((item) => item.idempotent).length,
  lexicalEquivalentCount: analyzed.filter((item) => item.lexicalEquivalent).length,
  conflictCount: conflicts.length,
  threshold: calibration.threshold,
  privateDiffArtifacts: analyzed.length,
}) + "\n");

function lowered(values) { return values.map((value) => value.toLocaleLowerCase("ru")); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
async function fileHash(path) { return hash(await readFile(path)); }
async function atomicWrite(path, value, mode) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, value, { mode });
  await rename(temporary, path);
}
