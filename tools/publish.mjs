#!/usr/bin/env node
/**
 * One-shot GitHub publishing driver for this plugin.
 *
 * Creates (or reuses) the repository, pushes this checkout, adds the
 * `dsh-plugin` topic, forks the community catalog, adds
 * data/plugins/<owner>__<repo>.yml on the fork, and opens the pull request.
 *
 *   node tools/publish.mjs --dry-run     check everything that needs no token
 *   node tools/publish.mjs               do it for real
 *
 * The token is read from GITHUB_TOKEN, or from .gh-token next to package.json
 * (git-ignored). It is never written to git config; the push URL carries it in
 * memory only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const config = JSON.parse(fs.readFileSync(path.join(root, 'publish/index.config.json'), 'utf8'))
const CATALOG = 'awesome-dsh-plugin/awesome-dsh-plugin'
const REPO = String(config.repoName || pkg.name)
const API = 'https://api.github.com'

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  const file = path.join(root, '.gh-token')
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
  return ''
}

const token = readToken()

async function api(method, route, body) {
  const response = await fetch(API + route, {
    method,
    headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-prompt-optimizer-publish',
      'x-github-api-version': '2022-11-28',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data = null
  try { data = text === '' ? null : JSON.parse(text) } catch { data = text }
  return { status: response.status, ok: response.ok, data }
}

function fail(step, result) {
  const raw = result && result.data
  const detail = raw && typeof raw === 'object' ? (raw.message || JSON.stringify(raw).slice(0, 300)) : String(raw || '').slice(0, 300)
  console.error('  FAIL ' + step + ' (HTTP ' + (result && result.status) + '): ' + detail)
  process.exit(1)
}

function entryYaml(owner) {
  const description = config.description || {}
  const quote = (text) => (/[:#]/.test(text) ? "'" + String(text).replace(/'/g, "''") + "'" : text)
  const lines = [
    'url: https://github.com/' + owner + '/' + REPO,
    'name: ' + owner + '/' + REPO,
    'category: ' + String(config.category || 'ui'),
    'description:',
    '  en: ' + quote(String(description.en || '')),
  ]
  if (description.zh) lines.push('  zh: ' + quote(String(description.zh)))
  return lines.join('\n') + '\n'
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

if (!config.description || !config.description.en) { console.error('publish/index.config.json needs description.en first'); process.exit(1) }

// The entry that will be written on the fork is kept in the repo too, so it can be
// reviewed, diffed and pasted by hand when no token is available.
if (process.argv.includes('--write-entry')) {
  const target = path.join(root, 'publish/awesome-dsh-plugin.yml')
  const owner = String(config.entryOwner || 'OWNER')
  fs.writeFileSync(target, entryYaml(owner))
  console.log('wrote publish/awesome-dsh-plugin.yml for ' + owner)
  process.exit(0)
}

if (dryRun) {
  console.log('dry run - nothing is sent')
  console.log('  token         : ' + (token === '' ? 'missing (fine for a dry run)' : 'present'))
  console.log('  repository    : ' + (config.repository || '(computed from the account)'))
  console.log('  repo name     : ' + REPO)
  console.log('  category      : ' + String(config.category || 'ui'))
  console.log('  catalog entry : data/plugins/<owner>__' + REPO + '.yml')
  console.log('  entry preview :')
  console.log(entryYaml('<owner>').split('\n').map((line) => '    ' + line).join('\n'))
  try {
    console.log('  worktree      : ' + (git(['status', '--porcelain']).trim() === '' ? 'clean' : 'DIRTY - commit before publishing'))
    console.log('  branch        : ' + (git(['branch', '--show-current']).trim() || 'main'))
  } catch (error) { console.log('  worktree      : unavailable (' + String(error.message).split('\n')[0] + ')') }
  process.exit(0)
}

if (token === '') { console.error('no token: set GITHUB_TOKEN or write it to .gh-token'); process.exit(1) }

const me = await api('GET', '/user')
if (!me.ok) fail('read the account behind the token', me)
const owner = me.data.login
console.log('account: ' + owner)

let repo = await api('GET', '/repos/' + owner + '/' + REPO)
if (repo.status === 404) {
  repo = await api('POST', '/user/repos', {
    name: REPO,
    description: String(config.description.en),
    homepage: 'https://github.com/' + owner + '/' + REPO,
    private: false,
    has_issues: true,
    has_wiki: false,
  })
  if (!repo.ok) fail('create the repository', repo)
  console.log('repo: created ' + repo.data.full_name)
} else if (repo.ok) {
  console.log('repo: reusing ' + repo.data.full_name)
} else {
  fail('look up the repository', repo)
}

// The push is the one step that needs a local git binary. Some sandboxes refuse to
// let this process spawn it, so --skip-push lets the caller do the push with its
// own shell and come back for the rest of the work.
if (process.argv.includes('--skip-push')) {
  try { git(['remote', 'remove', 'origin']) } catch { /* no remote yet */ }
  try { git(['remote', 'add', 'origin', 'https://github.com/' + owner + '/' + REPO + '.git']) } catch { /* remote already there */ }
  console.log('push: skipped (--skip-push); the remote now points at https://github.com/' + owner + '/' + REPO)
} else {
  const remoteUrl = 'https://x-access-token:' + token + '@github.com/' + owner + '/' + REPO + '.git'
  try {
    git(['push', remoteUrl, 'HEAD:refs/heads/main', '--force'])
  } catch (error) {
    console.error('  FAIL push: ' + String(error.stderr || error.message).slice(-400))
    console.error('  if this says EPERM, rerun with --skip-push and push from your own shell')
    process.exit(1)
  }
  try { git(['remote', 'remove', 'origin']) } catch { /* no remote yet */ }
  try { git(['remote', 'add', 'origin', 'https://github.com/' + owner + '/' + REPO + '.git']) } catch { /* remote already there */ }
  console.log('pushed HEAD -> main')
}

const topics = await api('PUT', '/repos/' + owner + '/' + REPO + '/topics', { names: ['dsh-plugin', 'deepseek-harness', 'prompt-engineering'] })
if (topics.ok) console.log('topics: ' + topics.data.names.join(', '))
else console.log('  warn topics: HTTP ' + topics.status + ' - add the dsh-plugin topic by hand')

const fork = await api('POST', '/repos/' + CATALOG + '/forks', { default_branch_only: true })
if (!fork.ok && fork.status !== 422) fail('fork the catalog', fork)

let ready = false
for (let attempt = 0; attempt < 20; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const probe = await api('GET', '/repos/' + owner + '/awesome-dsh-plugin')
  if (probe.ok) { ready = true; break }
}
if (!ready) { console.error('  the fork did not appear within a minute - rerun this script later'); process.exit(1) }
const forkRepo = 'awesome-dsh-plugin'

const entryPath = 'data/plugins/' + owner + '__' + REPO + '.yml'
const existing = await api('GET', '/repos/' + owner + '/' + forkRepo + '/contents/' + entryPath)
const put = await api('PUT', '/repos/' + owner + '/' + forkRepo + '/contents/' + entryPath, {
  message: 'add ' + owner + '/' + REPO,
  content: Buffer.from(entryYaml(owner), 'utf8').toString('base64'),
  ...(existing.ok ? { sha: existing.data.sha } : {}),
})
if (!put.ok) fail('write ' + entryPath, put)
console.log('catalog entry: ' + entryPath)

const pr = await api('POST', '/repos/' + CATALOG + '/pulls', {
  title: 'Add ' + owner + '/' + REPO,
  head: owner + ':' + forkRepo + 'main',
  base: 'main',
  body: [
    'Adds ' + owner + '/' + REPO + ' to the list.',
    '',
    '**What it does**: ' + String(config.description.en),
    '',
    '- package.json declares `dsh.bundle.patch` -> `cordis.patch.yml`',
    '- composer button on `conversation.input.right`, comparison card on `conversation.composer.dock`',
    '- Host routes answer loopback requests only; the prompt never leaves the machine',
  ].join('\n'),
})
if (!pr.ok) fail('open the pull request', pr)
console.log('pull request: ' + pr.data.html_url)
