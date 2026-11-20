#!/usr/bin/env node
/**
 * Write a DSH plugin market index (format 1) for this package.
 *
 * A host reads such a document as a market source: Plugins -> Discover ->
 * Index sources. The format is validated here with the very parser every host
 * uses (@deepseek-ai/dsh-plugin-market-index), so a document that leaves this
 * script is never one a host would reject.
 *
 *   node tools/build-index.mjs              write publish/index.json
 *   node tools/build-index.mjs --check      validate the file already there
 *   node tools/build-index.mjs --self-test  build and validate a sample
 *
 * A version needs either an npm package name or a git commit, so the index
 * becomes publishable only once one of those exists.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outFile = path.join(root, 'publish/index.json')
const configFile = path.join(root, 'publish/index.config.json')
const INDEX_URL = 'https://example.com/dsh-prompt-optimizer/index.json'
const checkOnly = process.argv.includes('--check')
const selfTest = process.argv.includes('--self-test')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

function inlineIcon() {
  const svg = fs.readFileSync(path.join(root, 'icon.svg'))
  if (svg.length > 24 * 1024) return undefined
  return 'data:image/svg+xml;base64,' + svg.toString('base64')
}

function build(config, pkg) {
  const repositoryUrl = String(config.repository || '')
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repositoryUrl)) {
    throw new Error('publish/index.config.json repository must be https://github.com/<owner>/<repo>')
  }
  const plugin = {
    name: String(config.npmPackage || pkg.name),
    title: { en: 'Prompt optimizer', zh: '提示词优化' },
    description: config.description ?? {},
    author: String(config.author || repositoryUrl.split('/')[3]),
    homepage: repositoryUrl + '#readme',
    repository: { url: repositoryUrl },
    metadata: { category: 'ui', keywords: ['prompt', 'composer', 'draft', 'scoring'] },
  }
  const icon = inlineIcon()
  if (icon !== undefined) plugin.icon = icon
  const source = /^[0-9a-f]{40}$/.test(String(config.commit || ''))
    ? { type: 'git', url: repositoryUrl, commit: String(config.commit) }
    : { type: 'npm' }
  const version = {
    version: String(pkg.version),
    publishTimestamp: Math.floor(Date.now() / 1000),
    source,
  }
  if (typeof config.enginesDsh === 'string' && config.enginesDsh !== '') version.engines = { dsh: config.enginesDsh }
  plugin.versions = [version]
  return {
    format: 1,
    title: { en: 'Local DSH plugin index', zh: '本地 DSH 插件索引' },
    description: { en: 'A plugin index served from this machine.', zh: '从本机提供的插件索引。' },
    metadata: { categories: { ui: { title: { en: 'Interface', zh: '界面' } } } },
    plugins: [plugin],
  }
}

function verify(index, label) {
  let parsed
  try {
    parsed = parseMarketIndex(index, INDEX_URL)
  } catch (error) {
    console.log('  FAIL ' + label + ' is not a valid format-1 index: ' + String(error.message).slice(0, 300))
    return false
  }
  console.log('  ok   ' + label + ' passes the official parser (' + parsed.plugins.length + ' plugin)')
  for (const entry of parsed.plugins) {
    for (const version of entry.versions) {
      const target = marketInstallTarget(entry.name, version)
      console.log('  ok   install target: ' + target.spec)
    }
  }
  return true
}

if (selfTest) {
  const sample = {
    format: 1,
    title: { en: 'Self test', zh: '自检' },
    metadata: { categories: { ui: { title: { en: 'Interface', zh: '界面' } } } },
    plugins: [{
      name: 'example-plugin',
      description: { en: 'Example.', zh: '示例。' },
      metadata: { category: 'ui' },
      icon: inlineIcon(),
      versions: [{ version: '0.1.0', publishTimestamp: 1700000000, source: { type: 'npm' } }],
    }],
  }
  const good = verify(sample, 'synthetic document')
  const broken = { format: 2, title: { zh: 'no english' }, plugins: [{ name: 'Bad Name', versions: [] }] }
  let caught = false
  try { parseMarketIndex(broken, INDEX_URL) } catch { caught = true }
  if (!good || !caught) { console.log('SELF-TEST FAILED'); process.exit(1) }
  console.log('SELF-TEST PASSED - valid document accepted, broken document rejected')
  process.exit(0)
}

if (checkOnly) {
  if (!fs.existsSync(outFile)) { console.log('publish/index.json does not exist yet - run without --check'); process.exit(1) }
  const ok = verify(JSON.parse(fs.readFileSync(outFile, 'utf8')), 'publish/index.json')
  process.exit(ok ? 0 : 1)
}

const config = JSON.parse(read('publish/index.config.json'))
const pkg = JSON.parse(read('package.json'))
if (/OWNER/.test(String(config.repository || '')) && !process.argv.includes('--allow-placeholder')) {
  console.log('publish/index.config.json still points at OWNER - fill in repository (and commit or npmPackage) first')
  process.exit(1)
}
const index = build(config, pkg)
if (!verify(index, 'generated index')) { process.exit(1) }
fs.writeFileSync(outFile, JSON.stringify(index) + '\n')
console.log('wrote publish/index.json (' + fs.statSync(outFile).size + ' bytes)')
