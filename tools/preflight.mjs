#!/usr/bin/env node
/**
 * Check this package against the rules a DSH host and the community catalog
 * both enforce, before anything is published.
 *
 *   node tools/preflight.mjs            offline checks
 *   node tools/preflight.mjs --online   also ask the npm registry for the name
 *
 * Exit code 0 only when every check passes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const online = process.argv.includes('--online')
const failures = []
const notes = []
const ok = (message) => console.log('  ok   ' + message)
const bad = (message) => { failures.push(message); console.log('  FAIL ' + message) }
const note = (message) => { notes.push(message); console.log('  note ' + message) }
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const pkg = JSON.parse(read('package.json'))

console.log('manifest')
const dsh = pkg.dsh ?? {}
if (dsh.bundle && typeof dsh.bundle.patch === 'string') ok('dsh.bundle.patch = ' + dsh.bundle.patch)
else bad('dsh.bundle.patch is missing - dsh.client alone is not installable')
const patch = dsh.bundle && typeof dsh.bundle.patch === 'string' ? dsh.bundle.patch : ''
if (patch !== '' && fs.existsSync(path.join(root, patch))) ok('patch file ' + patch + ' exists')
else bad('patch file ' + patch + ' does not exist')
if (dsh.client && dsh.client.platform === 'web') ok('dsh.client.platform = web')
else bad('dsh.client.platform must be web for a browser plugin')
const NAME_RE = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
if (typeof pkg.name === 'string' && pkg.name.length <= 214 && NAME_RE.test(pkg.name)) ok('name ' + pkg.name + ' is a valid npm name')
else bad('name ' + String(pkg.name) + ' is not a valid npm package name')
if (pkg.private !== true) ok('package is publishable (private is not set)')
else note('package.json sets private: true - remove it before publishing')
if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(pkg.version))) ok('version ' + pkg.version + ' is exact SemVer')
else bad('version ' + String(pkg.version) + ' is not exact SemVer')

console.log('files')
for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'docs/DETAIL.md', 'locale/en.json', 'locale/zh.json']) {
  if (fs.existsSync(path.join(root, file))) ok(file + ' present')
  else bad(file + ' missing')
}
const files = Array.isArray(pkg.files) ? pkg.files : []
for (const needed of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/*.json', 'docs']) {
  if (files.includes(needed)) ok('files[] lists ' + needed)
  else bad('files[] does not list ' + needed + ' - it will not ship')
}
const exportsMap = pkg.exports ?? {}
for (const key of ['.', './client', './locale/*.json', './icon']) {
  if (typeof exportsMap[key] === 'string') ok('exports ' + key + ' -> ' + exportsMap[key])
  else bad('exports ' + key + ' is missing')
}
const iconBytes = fs.statSync(path.join(root, 'icon.svg')).size
if (iconBytes <= 256 * 1024) ok('icon.svg is ' + iconBytes + ' bytes (limit 256 KiB)')
else bad('icon.svg is ' + iconBytes + ' bytes, over the 256 KiB limit')

console.log('locale')
for (const lang of ['en', 'zh']) {
  try {
    const meta = JSON.parse(read('locale/' + lang + '.json')).meta ?? {}
    if (typeof meta.title === 'string' && meta.title !== '' && typeof meta.description === 'string' && meta.description !== '') ok(lang + ' has meta.title and meta.description')
    else bad(lang + '.json needs meta.title and meta.description')
    if (typeof meta.detail === 'string' && fs.existsSync(path.join(root, meta.detail))) ok(lang + ' detail page ' + meta.detail + ' exists')
    else bad(lang + '.json meta.detail does not point at an existing document')
  } catch (error) {
    bad('locale/' + lang + '.json is not readable JSON: ' + error.message)
  }
}

console.log('host half')
const host = read('index.js')
if (/export\s+function\s+apply\s*\(/.test(host) || /export\s*\{[^}]*\bapply\b/.test(host) || /export\s+default\b[\s\S]*\bapply\b/.test(host)) ok('index.js exports apply(ctx, config)')
else bad('index.js does not export apply')
if (/export\s+const\s+inject\s*=/.test(host)) ok('index.js declares inject')
else note('index.js declares no inject list - correct only if it needs no service')

console.log('client half')
const client = read('client.js')
if (/window\.__ModuleLoader__\.load\(/.test(client)) ok('client.js uses window.__ModuleLoader__.load')
else bad('client.js must register through window.__ModuleLoader__.load')
if (/require\(['"]react['"]\)/.test(client)) ok('client.js takes React from the browser module table')
else bad('client.js must obtain React via require(react)')
if (!/require\(['"]@deepseek-ai\//.test(client)) ok('client.js imports no host-private primitives')
else bad('client.js requires a @deepseek-ai package - that is not available to plugins')
if (!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(client)) ok('client.js styles stay on --dsw-alias-* tokens')
else bad('client.js contains a literal colour')

console.log('copy')
if (client.includes('ctx.locale.register(')) {
  const injectLine = client.match(/inject:\s*\[([^\]]*)\]/)
  if (injectLine && /locale/.test(injectLine[1])) ok('locale is both injected and registered')
  else bad('client.js registers locale copy but does not inject locale - the host refuses ctx.locale')
}

console.log('publish config')
const configPath = path.join(root, 'publish/index.config.json')
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  for (const key of ['repository', 'name', 'npmPackage', 'commit']) {
    const value = config[key]
    if (typeof value === 'string' && value !== '' && !/OWNER/.test(value)) ok('publish config ' + key + ' = ' + value)
    else note('publish config ' + key + ' is not filled in yet')
  }
}

if (online) {
  console.log('npm registry')
  const name = String(pkg.name)
  try {
    const response = await fetch('https://registry.npmjs.org/' + name)
    if (response.status === 404) ok(name + ' is free on npm')
    else if (response.ok) {
      const meta = await response.json()
      const latest = meta['dist-tags'] && meta['dist-tags'].latest
      const maintainers = (meta.maintainers ?? []).map((m) => m.name).join(', ')
      bad(name + ' is already taken on npm (latest ' + latest + ', maintainers: ' + maintainers + ') - publish under another name')
    } else bad('registry answered HTTP ' + response.status + ' for ' + name)
  } catch (error) {
    note('registry unreachable, skipped the name check: ' + error.message)
  }
}

console.log('')
if (failures.length > 0) {
  console.log('PREFLIGHT FAILED - ' + failures.length + ' problem(s):')
  for (const failure of failures) console.log('  - ' + failure)
  process.exit(1)
}
console.log('PREFLIGHT PASSED' + (notes.length > 0 ? ' with ' + notes.length + ' note(s)' : ''))
