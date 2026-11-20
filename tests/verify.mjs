/**
 * Offline effectiveness check.
 *
 * Runs the SAME scorer the plugin ships (lib/score.js) over paired prompts and
 * applies the acceptance gate. Exits non-zero when the gate fails, so this is a
 * real gate and not a report.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scorePrompt, DIMENSIONS } from '../lib/score.js'

const here = dirname(fileURLToPath(import.meta.url))
const samples = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'))

export const GATE = {
  minAfterTotal: 70,
  minMeanDelta: 15,
  minSampleDelta: 8,
  maxDimensionDrop: 10,
  maxAfterChars: 2500,
  maxLengthRatio: 20
}

const rows = samples.map(function (sample) {
  const before = scorePrompt(sample.before)
  const after = scorePrompt(sample.after)
  const dims = DIMENSIONS.map(function (dim) {
    const a = before.dimensions.find(function (d) { return d.id === dim.id })
    const b = after.dimensions.find(function (d) { return d.id === dim.id })
    return { id: dim.id, zh: dim.zh, en: dim.en, weight: dim.weight, before: a.score, after: b.score, delta: b.score - a.score }
  })
  const ratio = before.chars === 0 ? 0 : Math.round((after.chars / before.chars) * 100) / 100
  const failures = []
  if (after.total < GATE.minAfterTotal) failures.push('after<' + GATE.minAfterTotal)
  if (after.total - before.total < GATE.minSampleDelta) failures.push('delta<' + GATE.minSampleDelta)
  const worstDrop = Math.min.apply(null, dims.map(function (d) { return d.delta }))
  if (worstDrop < -GATE.maxDimensionDrop) failures.push('dimension drop ' + worstDrop)
  if (ratio > GATE.maxLengthRatio) failures.push('length x' + ratio)
  if (after.chars > GATE.maxAfterChars) failures.push('too long ' + after.chars)
  return {
    id: sample.id,
    label: sample.label,
    before: before,
    after: after,
    delta: after.total - before.total,
    lengthRatio: ratio,
    dimensions: dims,
    worstDrop: worstDrop,
    pass: failures.length === 0,
    failures: failures
  }
})

const meanDelta = Math.round((rows.reduce(function (sum, r) { return sum + r.delta }, 0) / rows.length) * 10) / 10
const meanAfter = Math.round((rows.reduce(function (sum, r) { return sum + r.after.total }, 0) / rows.length) * 10) / 10
const meanBefore = Math.round((rows.reduce(function (sum, r) { return sum + r.before.total }, 0) / rows.length) * 10) / 10
const dimMeans = DIMENSIONS.map(function (dim) {
  const pick = rows.map(function (r) { return r.dimensions.find(function (d) { return d.id === dim.id }) })
  const before = Math.round(pick.reduce(function (sum, d) { return sum + d.before }, 0) / pick.length)
  const after = Math.round(pick.reduce(function (sum, d) { return sum + d.after }, 0) / pick.length)
  return { id: dim.id, zh: dim.zh, en: dim.en, before: before, after: after, delta: after - before }
})

const gateFailures = []
if (rows.some(function (r) { return !r.pass })) gateFailures.push('sample gate failed: ' + rows.filter(function (r) { return !r.pass }).map(function (r) { return r.id }).join(','))
if (meanDelta < GATE.minMeanDelta) gateFailures.push('mean delta ' + meanDelta + ' < ' + GATE.minMeanDelta)
if (meanAfter < GATE.minAfterTotal) gateFailures.push('mean after ' + meanAfter + ' < ' + GATE.minAfterTotal)
const dropped = dimMeans.filter(function (d) { return d.delta < 0 })
if (dropped.length > 0 && Math.min.apply(null, dropped.map(function (d) { return d.delta })) < -GATE.maxDimensionDrop) gateFailures.push('dimension mean regression')

const report = {
  generatedAt: new Date().toISOString(),
  sampleCount: rows.length,
  gate: GATE,
  gateFailures: gateFailures,
  passed: gateFailures.length === 0,
  meanBefore: meanBefore,
  meanAfter: meanAfter,
  meanDelta: meanDelta,
  dimensionMeans: dimMeans,
  rows: rows
}

writeFileSync(join(here, 'report.json'), JSON.stringify(report, null, 2))

console.log('sample                    before -> after   delta   len(x)  gate')
for (const row of rows) {
  const pad = row.label.padEnd(20, ' ')
  console.log(
    pad + '  ' + String(row.before.total).padStart(3) + ' -> ' + String(row.after.total).padStart(3) +
    '      ' + String(row.delta > 0 ? '+' + row.delta : row.delta).padStart(4) +
    '    x' + String(row.lengthRatio).padStart(4) +
    '   ' + (row.pass ? 'PASS' : 'FAIL ' + row.failures.join(','))
  )
}
console.log('')
console.log('mean  ' + meanBefore + ' -> ' + meanAfter + '  (delta ' + (meanDelta > 0 ? '+' + meanDelta : meanDelta) + ')')
console.log('')
console.log('dimension means (weight, before -> after):')
for (const dim of dimMeans) {
  console.log('  ' + dim.en.padEnd(20, ' ') + ' ' + String(dim.before).padStart(3) + ' -> ' + String(dim.after).padStart(3) + '  (' + (dim.delta > 0 ? '+' : '') + dim.delta + ')')
}
console.log('')
if (report.passed) {
  console.log('GATE PASSED — all ' + rows.length + ' samples >= ' + GATE.minAfterTotal + ' after, mean delta ' + meanDelta + ' >= ' + GATE.minMeanDelta)
} else {
  console.log('GATE FAILED — ' + gateFailures.join('; '))
  process.exitCode = 1
}
