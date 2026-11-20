import { readFileSync } from 'node:fs'
const r = JSON.parse(readFileSync('tests/report.json', 'utf8'))
console.log('gate=' + JSON.stringify(r.gate))
for (const row of r.rows) {
  console.log(row.label + ' | before=' + row.before.total + ' after=' + row.after.total + ' delta=' + row.delta +
    ' chars=' + row.before.chars + '->' + row.after.chars + ' tokens=' + row.before.estTokens + '->' + row.after.estTokens +
    ' worstDrop=' + row.worstDrop + ' pass=' + row.pass)
}
console.log('maxAfterChars=' + Math.max.apply(null, r.rows.map((x) => x.after.chars)))
console.log('meanBefore=' + r.meanBefore + ' meanAfter=' + r.meanAfter + ' meanDelta=' + r.meanDelta)
