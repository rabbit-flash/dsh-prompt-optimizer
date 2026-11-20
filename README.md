# dsh-prompt-optimizer

A DeepSeek Harness bundle that rewrites the composer draft with the model this session already uses, then shows an estimated before/after quality comparison.

## Install

1. Open **Plugins** in DSH and choose **Add plugin**.
2. Point it at this directory (the one containing `package.json`):
   `C:\Users\langb\Documents\deepseek-harness\default-workspace\dsh-prompt-optimizer`
3. Confirm the row `dsh-prompt-optimizer` appears and is enabled, then open a new session.

Installing writes the profile manifest for you; do not hand-edit the profile.

## Use

- The **优化提示词 / Optimize prompt** control sits in the composer's right control row, before the model picker.
- It is greyed out only while a rewrite is running. Clicking with an empty draft, or while a message is being sent, explains why instead of failing silently.
- On success the draft is replaced and a comparison card appears under the composer: total score before → after, six dimensions, the model's change list, character and ≈token counts, and **恢复原文 / Restore original**.
- If you type while the rewrite is in flight, the draft is **not** overwritten: the card offers **应用改写 / Apply rewrite** or **保留我的 / Keep mine**.

## Verify

```bash
bash tools/check-all.sh
```

Runs four independent gates, all offline: JS syntax for every module, the Host route contract (`tests/host.test.mjs`), the client slot components (`tests/client.test.mjs`), and the effect gate (`tests/verify.mjs`), which scores six paired prompts with the shipped scorer and fails the build if any sample or dimension regresses.

## Publish

DSH has no upload endpoint. A plugin reaches other machines through npm, through the community catalog, or through a market index — `publish/PUBLISH.md` walks each one, and `tools/preflight.mjs` checks the rules those channels enforce (including whether the package name is still free on npm).

```bash
node tools/preflight.mjs --online   # manifest, files, locale, name availability
node tools/build-index.mjs          # write publish/index.json (format 1, officially validated)
```

## Layout

| Path | Role |
|---|---|
| `index.js` | Host half: three loopback-only HTTP routes, model call through `ctx.llm` |
| `client.js` | Browser half: composer button + comparison panel, `--dsw-alias-*` tokens only |
| `lib/score.js` | Deterministic six-dimension estimator (shared by Host, UI, and the gate) |
| `lib/prompt.js` | The rewrite instruction and the tolerant JSON reader |
| `tests/` | Offline gates and the scored fixtures |
| `docs/DETAIL.md` | Plugin detail page (estimate table, request flow, failure modes) |
