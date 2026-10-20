/**
 * Candidate-engine experiment (Phases 14, 15, 16, 25, 26).
 *
 *   npx tsx --tsconfig tsconfig.json scripts/scoring/experiments/run-candidates.ts [--write-models] [--out docs/scoring-v4/experiments/<date>.json]
 *
 * 1. Scores every golden fixture through the production pipeline offline
 *    (no network) and builds one LabelledRow per fixture: canonical
 *    OpportunityFeatures + range label + band + split.
 * 2. Trains candidates B (calibrated_v4 search), C (ordinal logit),
 *    D (GBDT pairwise) and E (kNN) on TRAIN, selects on VALIDATION.
 * 3. Evaluates A–E on VALIDATION and on LOCKED (never used for fitting),
 *    plus the attack-clone invariance check and the program's ordering
 *    rules (buyer > founder > seller, …).
 * 4. Writes a JSON report; with --write-models also rewrites the model
 *    files under src/lib/scoring-v4/models/ (the engines import them).
 *
 * LOCKED is read only by the evaluation step. Keep it that way.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { GOLDEN_SET, type GoldenFixture } from '../../../tests/golden/fixtures'
import { RANKING_FIXTURES } from '../../../tests/golden/fixtures-ranking'
import { runOffline } from '../../../tests/helpers/score-source'
import { featuresFromPacket } from '../../../src/lib/scoring-v4/opportunity-features'
import { makeRow, toRangeLabels, type LabelledRow, BAND_ORDER_ASC } from '../../../src/lib/scoring-v4/train/dataset'
import { evaluate, expectedCalibrationError, macroF1, precisionRecallF1, type MetricReport, type Prediction } from '../../../src/lib/scoring-v4/metrics'
import { computeShadowCandidates } from '../../../src/lib/scoring-v4/shadow'
import { trainOrdinalLogit } from '../../../src/lib/scoring-v4/train/ordinal-logit'
import { trainGbdtPairwise } from '../../../src/lib/scoring-v4/train/gbdt-pairwise'
import { buildKnnModel } from '../../../src/lib/scoring-v4/train/knn'
import { searchCalibratedV4 } from '../../../src/lib/scoring-v4/train/calibrated-v4-search'
import { CALIBRATED_V4_PARAMS, type CalibratedV4Params } from '../../../src/lib/scoring-v4/models/calibrated-v4.params'
import { scoreCalibratedV4 } from '../../../src/lib/scoring-v4/engines/calibrated-v4'
import { scoreOrdinalLogit } from '../../../src/lib/scoring-v4/engines/ordinal-logit'
import { scoreGbdtPairwise } from '../../../src/lib/scoring-v4/engines/gbdt-pairwise'
import { scoreKnnFeatures } from '../../../src/lib/scoring-v4/engines/knn-features'
import { v3CurrentEngine } from '../../../src/lib/scoring-v4/engines/v3-current'
import type { OrdinalLogitModel } from '../../../src/lib/scoring-v4/models/ordinal-logit.model'
import type { GbdtPairwiseModel } from '../../../src/lib/scoring-v4/models/gbdt-pairwise.model'
import type { KnnFeaturesModel } from '../../../src/lib/scoring-v4/models/knn-features.model'
import type { CandidateScore, EngineId } from '../../../src/lib/scoring-v4/engines/types'
import { SCORING_VERSION } from '../../../src/lib/intelligence-v3/versions'

const REFERENCE_DATE = new Date('2026-10-20T00:00:00Z')
const args = process.argv.slice(2)
const writeModels = args.includes('--write-models')
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
const stamp = new Date().toISOString().slice(0, 10)
const outPath = resolve(outArg ?? `docs/scoring-v4/experiments/${stamp}-candidates.json`)
const MODELS_DIR = resolve('src/lib/scoring-v4/models')

/** Fixture expectations and V3's own classification, for the Phase 18 metrics. */
const EXPECT = new Map<string, { roles: string[] | null; intents: string[] | null; actions: string[] | null; bands: string[] | null }>()
const V3META = new Map<string, { role: string; intent: string; action: string; packet: Awaited<ReturnType<typeof runOffline>> }>()

async function buildRows(): Promise<LabelledRow[]> {
  const rows: LabelledRow[] = []
  // Golden fixtures carry V3's calibration contract; ranking fixtures carry
  // program-truth ranges written independently of V3. Both are labelled rows.
  const all: GoldenFixture[] = [...(GOLDEN_SET as GoldenFixture[]), ...RANKING_FIXTURES]
  for (const f of all) {
    const packet = await runOffline(f.rawText, { model: f.model ?? null, referenceDate: REFERENCE_DATE })
    const features = featuresFromPacket(packet, f.rawText)
    if (!features) { console.warn(`no features for ${f.id}`); continue }
    EXPECT.set(f.id, { roles: f.expect.relationshipRole ?? null, intents: f.expect.buyerIntent ?? null, actions: f.expect.action ?? null, bands: f.expect.qualification ?? null })
    V3META.set(f.id, { role: packet.buyerIntent?.relationshipRole ?? 'UNKNOWN', intent: packet.buyerIntent?.buyerIntentLevel ?? 'UNKNOWN', action: packet.recommendedAction?.action ?? packet.action, packet })
    rows.push(makeRow({
      id: f.id,
      category: f.category,
      features,
      v3Score: packet.score,
      range: f.expect.scoreRange ?? null,
      bands: (f.expect.qualification as LabelledRow['band'][] | undefined) ?? null,
      baseId: f.id.startsWith('attack-') ? 'attack-base' : null,
    }))
  }
  return rows
}

type Scorers = {
  calibrated: CalibratedV4Params
  ordinal: OrdinalLogitModel
  gbdt: GbdtPairwiseModel
  knn: KnnFeaturesModel
}

function scoreWith(engine: EngineId, row: LabelledRow, s: Scorers): CandidateScore {
  switch (engine) {
    case 'v3': return v3CurrentEngine.score(row.features, { v3Score: row.v3Score })
    case 'calibrated_v4': return scoreCalibratedV4(row.features, s.calibrated)
    case 'ordinal_logit': return scoreOrdinalLogit(row.features, s.ordinal)
    case 'gbdt_pairwise': return scoreGbdtPairwise(row.features, s.gbdt)
    case 'knn_features': return scoreKnnFeatures(row.features, s.knn, row.id)
  }
}

const ENGINE_LIST: EngineId[] = ['v3', 'calibrated_v4', 'ordinal_logit', 'gbdt_pairwise', 'knn_features']

function predictions(engine: EngineId, rows: LabelledRow[], s: Scorers): Prediction[] {
  return rows.map((r) => { const c = scoreWith(engine, r, s); return { id: r.id, score: c.score, band: c.qualification, confidence: c.confidence } })
}

/** Program orderings (Phase 8), checked as category-mean inequalities. */
function orderingChecks(engine: EngineId, rows: LabelledRow[], s: Scorers): Array<{ rule: string; pass: boolean; detail: string }> {
  const meanOf = (cats: string[]) => {
    const xs = rows.filter((r) => cats.includes(r.category)).map((r) => scoreWith(engine, r, s).score)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
  }
  const rules: Array<{ rule: string; hi: string[]; lo: string[]; margin: number }> = [
    { rule: 'explicit buyer > active founder (unknown intent)', hi: ['explicit_buyer', 'explicit_contractor', 'upwork_style_buyer'], lo: ['technical_founder', 'nontechnical_founder', 'active_builder', 'startup_founder', 'funded_startup', 'bootstrap_startup'], margin: 10 },
    { rule: 'strong-fit founder > generic founder', hi: ['strong_fit_no_intent', 'funded_startup'], lo: ['nontechnical_founder', 'stale_founder'], margin: 5 },
    { rule: 'external development need > employee hiring', hi: ['company_requesting_agency', 'explicit_contractor'], lo: ['company_hiring_employees', 'current_hiring'], margin: 5 },
    { rule: 'founder > software-services seller', hi: ['technical_founder', 'funded_startup', 'active_builder'], lo: ['service_provider', 'competitor', 'agency'], margin: 5 },
    { rule: 'seller > recruiter/candidate', hi: ['service_provider', 'product_seller'], lo: ['recruiter', 'candidate', 'job_seeker'], margin: 0 },
  ]
  return rules.map((r) => {
    const a = meanOf(r.hi), b = meanOf(r.lo)
    const pass = Number.isFinite(a) && Number.isFinite(b) ? a - b >= r.margin : false
    return { rule: r.rule, pass, detail: `${a.toFixed(1)} vs ${b.toFixed(1)}` }
  })
}

/**
 * Attack clones are one profile with one planted line each; no attack may
 * move the score. The check is label-free: the spread of clone scores
 * around their median, and how many clones sit more than 3 points away.
 */
function invarianceCheck(engine: EngineId, rows: LabelledRow[], s: Scorers): { clones: number; maxDelta: number; violations: number; median: number } {
  const clones = rows.filter((r) => r.attackClone)
  if (clones.length === 0) return { clones: 0, maxDelta: 0, violations: 0, median: 0 }
  const scores = clones.map((c) => scoreWith(engine, c, s).score).sort((a, b) => a - b)
  const median = scores[Math.floor(scores.length / 2)]
  let maxDelta = 0, violations = 0
  for (const sc of scores) {
    const d = Math.abs(sc - median)
    maxDelta = Math.max(maxDelta, d)
    if (d > 3) violations++
  }
  return { clones: clones.length, maxDelta, violations, median }
}

/**
 * Phase 18 classification metrics on the distinct fixtures. Buyer and role
 * come from the packet (shared by every engine); action is the policy run
 * on each engine's band; confidence calibration is each engine's
 * confidence against "band inside the expected band set".
 */
function classificationMetrics(engine: EngineId, rows: LabelledRow[], s: Scorers) {
  const buyerRows: Array<{ predicted: boolean; actual: boolean }> = []
  const roleRows: Array<{ predicted: string; actual: string }> = []
  const actionRows: Array<{ predicted: string; actual: string }> = []
  const calib: Array<{ p: number; y: 0 | 1 }> = []
  for (const r of rows) {
    const e = EXPECT.get(r.id), m = V3META.get(r.id)
    if (!e || !m) continue
    const c = scoreWith(engine, r, s)
    if (e.intents) buyerRows.push({ predicted: ['HIGH', 'MEDIUM'].includes(m.intent), actual: e.intents.some((x) => x === 'HIGH' || x === 'MEDIUM') && !e.intents.includes('UNKNOWN') })
    if (e.roles && e.roles.length === 1) roleRows.push({ predicted: m.role, actual: e.roles[0] })
    if (e.actions) {
      const action = engine === 'v3' ? m.action : (computeShadowCandidates(m.packet, null, { engines: [engine] }).rows[0]?.candidateAction ?? m.action)
      actionRows.push({ predicted: action, actual: e.actions.includes(action) ? action : e.actions[0] })
    }
    if (e.bands) calib.push({ p: c.confidence, y: e.bands.includes(c.qualification) ? 1 : 0 })
  }
  return {
    buyer: precisionRecallF1(buyerRows),
    role: macroF1(roleRows),
    action: { accuracy: macroF1(actionRows).accuracy, n: actionRows.length },
    confidence: expectedCalibrationError(calib),
  }
}

function histogram(engine: EngineId, rows: LabelledRow[], s: Scorers): Record<string, number> {
  const h: Record<string, number> = {}
  for (const r of rows) { const q = scoreWith(engine, r, s).qualification; h[q] = (h[q] ?? 0) + 1 }
  return h
}

function tsModule(header: string, name: string, type: string, importLine: string, value: unknown): string {
  return `${header}\n\n${importLine}\n\nexport const ${name}: ${type} = ${JSON.stringify(value, null, 2)}\n`
}

async function main() {
  console.log(`Building labelled rows from ${GOLDEN_SET.length} golden fixtures (production ${SCORING_VERSION}, offline)…`)
  const rows = await buildRows()
  const distinct = rows.filter((r) => !r.attackClone)
  const train = distinct.filter((r) => r.split === 'train')
  const validation = distinct.filter((r) => r.split === 'validation')
  const locked = distinct.filter((r) => r.split === 'locked')
  console.log(`rows=${rows.length} distinct=${distinct.length} train=${train.length} validation=${validation.length} locked=${locked.length} clones=${rows.length - distinct.length}`)

  // ── Train ─────────────────────────────────────────────────────────────
  const search = searchCalibratedV4(CALIBRATED_V4_PARAMS, train, validation)
  const ordinal = trainOrdinalLogit(train, { trainedOn: `${train.length} golden train rows` })
  const gbdt = trainGbdtPairwise(train, { validation, trainedOn: `${train.length} golden train rows` })
  const knn = buildKnnModel(train, { validation, trainedOn: `${train.length} golden train rows` })
  const scorers: Scorers = { calibrated: search.params, ordinal, gbdt, knn }
  console.log(`calibrated_v4 search: train obj ${search.trainObjective}, validation obj ${search.validationObjective}, sweeps ${search.sweepsRun}`)
  console.log(`gbdt: ${gbdt.trees.length} trees · knn: k=${knn.k}`)

  // ── Evaluate ──────────────────────────────────────────────────────────
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    productionVersion: SCORING_VERSION,
    rows: { total: rows.length, distinct: distinct.length, train: train.length, validation: validation.length, locked: locked.length, attackClones: rows.length - distinct.length },
    engines: {} as Record<string, unknown>,
    models: { calibrated: search.params.version, ordinal: ordinal.version, gbdt: gbdt.version, knn: knn.version },
  }
  const splits: Array<[string, LabelledRow[]]> = [['train', train], ['validation', validation], ['locked', locked]]
  const table: string[] = []
  for (const engine of ENGINE_LIST) {
    const metrics: Record<string, MetricReport> = {}
    for (const [name, set] of splits) metrics[name] = evaluate(predictions(engine, set, scorers), toRangeLabels(set), BAND_ORDER_ASC)
    const ordering = orderingChecks(engine, distinct, scorers)
    const invariance = invarianceCheck(engine, rows, scorers)
    const hist = histogram(engine, distinct, scorers)
    const classification = classificationMetrics(engine, distinct, scorers)
    ;(report.engines as Record<string, unknown>)[engine] = { metrics, ordering, invariance, qualificationHistogram: hist, classification }
    const L = metrics.locked, V = metrics.validation
    table.push(`${engine.padEnd(15)} locked: spearman ${L.spearman.toFixed(2)} pairwise ${L.pairwise.accuracy.toFixed(2)} ndcg10 ${L.ndcg10.toFixed(2)} top10% ${L.topDecile.precision.toFixed(2)} inRange ${L.rangeMae.inRange.toFixed(2)} mae ${L.rangeMae.mae.toFixed(1)} band ${L.ordinal.exact.toFixed(2)} | val: spearman ${V.spearman.toFixed(2)} pairwise ${V.pairwise.accuracy.toFixed(2)} inRange ${V.rangeMae.inRange.toFixed(2)} | ordering ${ordering.filter((o) => o.pass).length}/${ordering.length} | invariance maxΔ ${invariance.maxDelta} viol ${invariance.violations}`)
  }
  console.log('\n' + table.join('\n'))
  console.log('\nCLASSIFICATION (distinct fixtures; buyer and role are packet-level and shared)')
  for (const engine of ENGINE_LIST) {
    const c = (report.engines as Record<string, { classification: ReturnType<typeof classificationMetrics> }>)[engine].classification
    console.log(`${engine.padEnd(15)} buyer P ${c.buyer.precision} R ${c.buyer.recall} F1 ${c.buyer.f1} · role macro-F1 ${c.role.macroF1} · action acc ${c.action.accuracy} (n=${c.action.n}) · confidence ECE ${c.confidence.ece}`)
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`\nreport → ${outPath}`)

  if (writeModels) {
    writeFileSync(resolve(MODELS_DIR, 'calibrated-v4.params.ts'), tsModule(
      `/**\n * Parameters for the calibrated_v4 deterministic engine.\n *\n * GENERATED by scripts/scoring/experiments/run-candidates.ts on ${stamp}\n * (coordinate search on TRAIN, selected on VALIDATION, LOCKED never read).\n * Hand edits are overwritten on the next run; change the search space in\n * src/lib/scoring-v4/train/calibrated-v4-search.ts instead.\n */`,
      'CALIBRATED_V4_PARAMS', 'CalibratedV4Params',
      `export interface CalibratedV4Params {\n  version: string\n  trainedOn: string\n  weights: { intent: number; account: number; fit: number; authority: number; access: number; timing: number; evidence: number }\n  account: { maturity: number; build: number; complexity: number; outsourcing: number; hiring: number; funding: number; product: number }\n  intentRaw: { HIGH: number; MEDIUM: number; LOW: number; UNKNOWN: number }\n  budgetBonus: number\n  fitRaw: { NONE: number; WEAK: number; ADJACENT: number; GOOD: number; STRONG: number; EXCEPTIONAL: number }\n  rescale: { a: number; b: number }\n}`,
      search.params,
    ))
    writeFileSync(resolve(MODELS_DIR, 'ordinal-logit.model.ts'), tsModule(
      `/**\n * Candidate C model — proportional-odds ordinal logistic regression.\n * GENERATED by scripts/scoring/experiments/run-candidates.ts on ${stamp}. Do not edit; retrain.\n */`,
      'ORDINAL_LOGIT_MODEL', 'OrdinalLogitModel',
      `export interface OrdinalLogitModel {\n  version: string\n  trainedOn: string\n  featureNames: string[]\n  weights: number[]\n  cuts: number[]\n  scoreMap: { a: number; b: number }\n}`,
      ordinal,
    ))
    writeFileSync(resolve(MODELS_DIR, 'gbdt-pairwise.model.ts'), tsModule(
      `/**\n * Candidate D model — gradient-boosted depth-2 trees, pairwise objective.\n * GENERATED by scripts/scoring/experiments/run-candidates.ts on ${stamp}. Do not edit; retrain.\n */`,
      'GBDT_PAIRWISE_MODEL', 'GbdtPairwiseModel',
      `export interface GbdtTree {\n  feature: number\n  threshold: number\n  left: GbdtNode\n  right: GbdtNode\n}\nexport type GbdtNode = { leaf: number } | GbdtTree\n\nexport interface GbdtPairwiseModel {\n  version: string\n  trainedOn: string\n  featureNames: string[]\n  learningRate: number\n  trees: GbdtTree[]\n  scoreMap: { a: number; b: number }\n}`,
      gbdt,
    ))
    writeFileSync(resolve(MODELS_DIR, 'knn-features.model.ts'), tsModule(
      `/**\n * Candidate E model — kNN reference set in OpportunityFeatures space.\n * GENERATED by scripts/scoring/experiments/run-candidates.ts on ${stamp}. Do not edit; rebuild.\n */`,
      'KNN_FEATURES_MODEL', 'KnnFeaturesModel',
      `export interface KnnReference {\n  id: string\n  vector: number[]\n  label: number\n  band: string\n}\n\nexport interface KnnFeaturesModel {\n  version: string\n  trainedOn: string\n  featureNames: string[]\n  featureWeights: number[]\n  k: number\n  references: KnnReference[]\n}`,
      knn,
    ))
    console.log(`models written → ${MODELS_DIR}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
