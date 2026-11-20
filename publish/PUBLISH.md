# Publishing the prompt optimizer

There is no upload endpoint in DSH itself. A DSH plugin reaches other machines through three channels, and each one needs an account this workspace does not hold: `pnpm whoami` reports `ERR_PNPM_WHOAMI_UNAUTHORIZED`, `~/.npmrc` and `~/.ssh` are absent, `git credential fill` has no helper, and `GITHUB_TOKEN`/`GH_TOKEN`/`NPM_TOKEN` are unset.

| Channel | What it needs | How |
|---|---|---|
| Community catalog (Plugins -> Discover) | a public GitHub repo, then one PR | `node tools/publish.mjs` |
| npm (`dsh plugin add <pkg>`) | an npm account | `pnpm login && pnpm publish --access public` |
| Market index (Discover -> Index sources) | a JSON file at any URL | `node tools/build-index.mjs` |
| This machine only | nothing | done (Plugins -> Add plugin) |

## 1. Check the package first

```bash
bash tools/check-all.sh      # syntax, host routes, client slots, score gate, preflight
node tools/preflight.mjs --online   # also asks npm whether the name is free
```

## 2. GitHub repo + community catalog (one command)

Two kinds of token work; a classic token needs the `repo` scope, a fine-grained one needs *Administration: write* on the new repo plus *Pull requests: write* and *Contents: write* on `awesome-dsh-plugin/awesome-dsh-plugin`.

```bash
# either export it for one shell ...
export GITHUB_TOKEN=ghp_...
# ... or keep it in a file next to package.json (git-ignored)
printf '%s' 'ghp_...' > .gh-token

node tools/publish.mjs --dry-run    # what it would do, sends nothing
node tools/publish.mjs              # repo, push, topic, fork, entry, PR
```

It is idempotent: a repo that already exists is reused, a catalog entry that already exists is updated. If the sandbox refuses to let the script spawn `git` (`EPERM spawnSync git`), rerun with `--skip-push` and run these two lines in your own shell first:

```bash
git remote add origin https://github.com/OWNER/dsh-prompt-optimizer.git
git push -u origin HEAD:main
node tools/publish.mjs --skip-push
```

The entry it writes is `data/plugins/<owner>__<repo>.yml`, generated from `publish/index.config.json`. Their CI checks — all satisfied by this package — are: `dsh.bundle` declared (not just `dsh.client`, the most common rejection), a `cordis.patch.yml` next to it, real code, a repository at least one day old, the `dsh-plugin` topic, and a description that matches the code.

## 3. npm

`dsh-prompt-optimizer` is already published on npm by another author (v2.0.3), and `dsh-plugin-prompt-optimizer` by a third (v0.1.0). Free names include `dsh-prompt-tune`, `dsh-prompt-scorer`, `dsh-prompt-grader`, `dsh-prompt-improver`, `dsh-prompt-quality`.

```bash
pnpm login
node tools/preflight.mjs --online
pnpm publish --access public
```

Renaming means editing `name` in `package.json` and in `cordis.patch.yml`, the loader id at the top of `client.js`, and the expectations in `tests/client.test.mjs` — `tools/preflight.mjs` fails loudly while they disagree.

## 4. Market index (format 1)

A host can read a single JSON document as a market source: Plugins -> Discover -> Index sources. `tools/build-index.mjs` writes that document and validates it with the same parser the host uses (`@deepseek-ai/dsh-plugin-market-index`).

```bash
# fill publish/index.config.json first (repository, and npmPackage or commit)
node tools/build-index.mjs --self-test   # proves the document shape is valid
node tools/build-index.mjs               # writes publish/index.json
```

A version needs an npm package or a git commit, so the index becomes publishable only after step 2 or 3.
