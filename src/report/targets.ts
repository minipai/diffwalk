import type { ExplainDocument } from '../format'

export interface ReportChangeTarget {
  id: string
  fragment: string
  canonical: boolean
}

export interface ReportStepTarget {
  fragment: string
  changes: ReportChangeTarget[]
}

export interface ReportSectionTarget {
  fragment: string
  steps: ReportStepTarget[]
}

export function reportTargets(document: ExplainDocument): ReportSectionTarget[] {
  const sectionFingerprints = document.sections.map((section) =>
    JSON.stringify({
      title: section.title,
      steps: section.steps.map(stepFingerprint).sort(),
    }),
  )
  const sectionFragments = stableFragments(
    document.sections.map((section, index) => ({
      base: `section-${slug(section.title)}`,
      fingerprint: sectionFingerprints[index]!,
      alwaysDisambiguate: true,
    })),
  )

  const flatSteps = document.sections.flatMap((section, sectionIndex) =>
    section.steps.map((step, stepIndex) => ({
      sectionIndex,
      stepIndex,
      step,
      base: `step-${slug(step.changes?.join('-') ?? step.text)}`,
      fingerprint: `${JSON.stringify(section.title)}\0${stepFingerprint(step)}`,
      alwaysDisambiguate: true,
    })),
  )
  const stepSeedCounts = new Map<string, number>()
  for (const step of flatSteps) {
    const key = `${step.base}\0${step.fingerprint}`
    stepSeedCounts.set(key, (stepSeedCounts.get(key) ?? 0) + 1)
  }
  // Sibling content distinguishes only same-titled sections whose local step seed collides.
  const stepFragments = stableFragments(
    flatSteps.map((step) => ({
      ...step,
      fingerprint:
        stepSeedCounts.get(`${step.base}\0${step.fingerprint}`) === 1
          ? step.fingerprint
          : `${step.fingerprint}\0${sectionFingerprints[step.sectionIndex]}`,
    })),
  )

  const changeIds = [...new Set(flatSteps.flatMap(({ step }) => step.changes ?? []))]
  const changeTargetFragments = stableFragments(
    changeIds.map((candidate) => ({
      base: `change-${slug(candidate.replace(/^change-/, ''))}`,
      fingerprint: candidate,
      alwaysDisambiguate: false,
    })),
  )
  const changeFragments = new Map(
    changeIds.map((id, index) => [id, changeTargetFragments[index]!]),
  )

  const targets = document.sections.map<ReportSectionTarget>((section, sectionIndex) => ({
    fragment: sectionFragments[sectionIndex]!,
    steps: section.steps.map(() => ({ fragment: '', changes: [] })),
  }))

  for (const [index, entry] of flatSteps.entries()) {
    targets[entry.sectionIndex]!.steps[entry.stepIndex] = {
      fragment: stepFragments[index]!,
      changes: (entry.step.changes ?? []).map((id) => ({
        id,
        fragment: changeFragments.get(id)!,
        canonical: false,
      })),
    }
  }

  for (const id of changeIds) {
    const occurrences = targets
      .flatMap((section) =>
        section.steps.flatMap((step) =>
          step.changes
            .filter((change) => change.id === id)
            .map((change) => ({ owner: step.fragment, change })),
        ),
      )
      .sort((left, right) => compare(left.owner, right.owner))
    occurrences[0]!.change.canonical = true
  }

  return targets
}

function stepFingerprint(step: ExplainDocument['sections'][number]['steps'][number]): string {
  return JSON.stringify({ text: step.text, diff: step.diff, changes: step.changes })
}

interface FragmentSeed {
  base: string
  fingerprint: string
  alwaysDisambiguate: boolean
}

function stableFragments(seeds: FragmentSeed[]): string[] {
  const bases = new Map<string, FragmentSeed[]>()
  for (const seed of seeds) {
    const group = bases.get(seed.base) ?? []
    group.push(seed)
    bases.set(seed.base, group)
  }

  const occurrences = new Map<string, number>()
  return seeds.map((seed) => {
    const group = bases.get(seed.base)!
    let fragment = seed.base
    if (
      seed.alwaysDisambiguate ||
      group.some((candidate) => candidate.fingerprint !== seed.fingerprint)
    ) {
      fragment += `-${fingerprintHash(seed.fingerprint)}`
    }

    const collidingFingerprints = [
      ...new Set(
        group
          .filter(
            (candidate) =>
              fingerprintHash(candidate.fingerprint) === fingerprintHash(seed.fingerprint),
          )
          .map((candidate) => candidate.fingerprint),
      ),
    ].sort()
    if (collidingFingerprints.length > 1) {
      fragment += `-${collidingFingerprints.indexOf(seed.fingerprint) + 1}`
    }

    const occurrence = (occurrences.get(fragment) ?? 0) + 1
    occurrences.set(fragment, occurrence)
    return occurrence === 1 ? fragment : `${fragment}-${occurrence}`
  })
}

function slug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48)
      .replace(/-$/, '') || 'item'
  )
}

function fingerprintHash(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
