/* Clinical Scoring Engine — the GENERIC, score-agnostic core (architecture:
   docs/design/clinical-scoring-engine.md §1). It knows nothing about SOFA:
   a score is a DEFINITION (its components + how each resolves its inputs),
   and the engine aggregates component results into a total + per-component
   breakdown, honouring the locked principles independent of any one score:

     P1  missing input → the component is INCOMPLETE ("insufficient data"),
         NEVER scored 0; the total is flagged partial, never falsely complete.
     P3  always total + per-component breakdown.
     P5  computed at render, never stored (this module has no persistence).

   SOFA is the first definition (src/lib/scoring/sofa.ts); qSOFA / APACHE II /
   NEWS2 plug in later as more definitions, with no change here. */

/** the two views the SOFA spec (§2.3) asks for, kept generic:
 *  'worst'  — the worst value of each input within the window (primary)
 *  'latest' — the most recent value of each input within the window */
export type ScoreMode = 'worst' | 'latest'

/** one contributing value behind a component score, for the breakdown */
export interface Contributor {
  label: string
  /** the value as displayed (already unit-formatted by the definition) */
  display: string
  /** the source time as stored ("06:00", "D-1 22:15", "2026-07-14 09:30") */
  timeLabel: string
}

/** the outcome of scoring ONE component. `score === null` is the P1
 *  insufficient-data state — it is never coerced to 0. */
export interface ComponentResult {
  /** 0..componentMax, or null = insufficient data (INCOMPLETE) */
  score: number | null
  /** present iff score === null — names exactly which input was missing */
  incompleteReason?: string
  /** one-line human summary of what drove the score (or why it couldn't) */
  detail: string
  contributors: Contributor[]
  /** a non-blocking caveat surfaced alongside a computed score (e.g. a
   *  cap was applied, or a renal score came from creatinine only) */
  note?: string
}

/** a component of a score definition: an identity + a pure scorer that
 *  reads the already-resolved context for the chosen mode. */
export interface ScoreComponent<Ctx> {
  key: string
  label: string
  /** the component's maximum (SOFA: 4) — used for display, never to fill
   *  a missing value */
  max: number
  score: (ctx: Ctx, mode: ScoreMode) => ComponentResult
}

/** a full score definition. `buildContext` resolves the declared canonical
 *  inputs into a context the components read; `asOfMinutesAgo` lets the
 *  same definition be evaluated at earlier timepoints for the trend (P4). */
export interface ScoreDefinition<Ctx> {
  /** stable id + version so future/modified variants are SEPARATE
   *  definitions, never a mutation of this one (SOFA spec §2.7) */
  id: string
  version: string
  label: string
  /** the maximum total (SOFA: 24) — display only */
  maxTotal: number
  components: ScoreComponent<Ctx>[]
}

/** one component's line in an aggregated result */
export interface ScoredComponent extends ComponentResult {
  key: string
  label: string
  max: number
}

/** the aggregate — total of the COMPUTED components only, with the
 *  incomplete ones named (P1/P3). `complete` is false whenever any
 *  component is insufficient-data. */
export interface ScoreResult {
  id: string
  version: string
  label: string
  mode: ScoreMode
  /** sum of the computed components only (a PARTIAL total when !complete) */
  total: number
  maxTotal: number
  complete: boolean
  computedCount: number
  componentCount: number
  /** the components that could not be scored (P1) — for the flag text */
  incompleteComponents: string[]
  components: ScoredComponent[]
}

/** aggregate a definition over an already-built context. Pure; the P1/P3
 *  discipline lives here so every score inherits it. */
export function aggregate<Ctx>(
  def: ScoreDefinition<Ctx>,
  ctx: Ctx,
  mode: ScoreMode,
): ScoreResult {
  const components: ScoredComponent[] = def.components.map(c => {
    const r = c.score(ctx, mode)
    return { key: c.key, label: c.label, max: c.max, ...r }
  })
  const computed = components.filter(c => c.score !== null)
  const total = computed.reduce((s, c) => s + (c.score as number), 0)
  const incompleteComponents = components.filter(c => c.score === null).map(c => c.label)
  return {
    id: def.id,
    version: def.version,
    label: def.label,
    mode,
    total,
    maxTotal: def.maxTotal,
    complete: incompleteComponents.length === 0,
    computedCount: computed.length,
    componentCount: components.length,
    incompleteComponents,
    components,
  }
}
