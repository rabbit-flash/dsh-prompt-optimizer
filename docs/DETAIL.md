# Prompt optimizer

A composer-side prompt rewriter for DeepSeek Harness. Press the button beside the send control and the draft is rewritten by the model this session is already using; a comparison panel then shows the estimated quality before and after.

## What it does

- **Composer button** (`conversation.input.right`): one compact control next to the model picker. It is disabled while the draft is empty, while a message is being submitted, or while a rewrite is in flight.
- **Rewrite**: the draft text goes to `POST /api/prompt-optimizer/optimize`, which streams one request through `ctx.llm.stream` using the session's current `{ provider, model }` (falling back to the deployment default). The reply is parsed as `{ optimized, changes }` and written back into the draft with `inputActions.setDraft`, so the user can still edit or undo it before sending.
- **Comparison panel** (`conversation.composer.dock`): total score before over arrow to total score after, a six-dimension bar comparison, the change list, the character and estimated-token counts, and a **Restore original** button.

## The estimate

Both numbers come from `lib/score.js`, a deterministic heuristic over surface features. It never calls a model, so the same text always produces the same score, and the Host and any offline check share one implementation.

| Dimension | Weight | What raises it |
|---|---|---|
| Structure | 0.20 | Markdown headings, list items, multiple paragraphs, explicit sections (`Task:`/`要求：`/…) |
| Role & constraints | 0.20 | A role statement, hard rules (`must`/`禁止`/`只输出`/…), audience or tone |
| Context | 0.15 | Background, technical or business vocabulary, stated purpose |
| Concision | 0.15 | Shorter length with the same information, fewer filler words, fewer repeated sentences |
| Output format | 0.15 | A stated output shape (JSON/Markdown/table), a length bound |
| Examples | 0.15 | A mentioned example or an inline sample block |

The total is the weighted sum of the six, rounded to an integer out of 100. This is an estimate, not a judgement: it rewards the features a model-facing prompt usually needs, and it cannot tell whether the requested work is sensible.

## Request flow

```text
composer draft ──► POST /api/prompt-optimizer/optimize ──► ctx.llm.stream(session route)
      ▲                                                            │
      │ inputActions.setDraft(optimized)                            ▼
      └────────────── { optimized, changes, before, after } ◄── parse reply
```

Both routes sit behind the same loopback trust fence the shipped plugins use: a loopback socket address, a loopback `Host` header, no forwarding header, `sec-fetch-site` not `cross-site`, and a matching `Origin` when one is present. Anything else receives `403 { error: 'forbidden: loopback-only' }`.

## Failure modes

| Situation | What the user sees |
|---|---|
| No model selected and no deployment default | `优化失败: no model route…` |
| Provider error, quota, or auth failure | `优化失败:` plus the provider failure message and code |
| Model returns prose instead of JSON | The prose becomes the rewrite (fenced blocks stripped) |
| Model returns nothing | `优化失败: model returned an empty rewrite` |

The draft is never replaced on a failure; it is only replaced on a successful rewrite, and **Restore original** puts the pre-optimization text back.

## Configuration

`enabled` (boolean, default `true`) turns both routes off without removing the bundle.

## Privacy

The draft is sent only to the provider already configured for this session, over the Host's own `ctx.llm` path. Nothing is written to disk, and the panel keeps its state in memory for the current page only.

## Verification

`bash tools/check-all.sh` runs four offline gates. The third one, `tests/verify.mjs`, is the acceptance gate: it scores six paired prompts (a rough draft and its rewrite) with the same `lib/score.js` the UI uses, writes `tests/report.json`, and exits non-zero unless every rule below holds.

| Rule | Threshold |
|---|---|
| After score, every sample | >= 70 |
| Score gain, every sample | >= 8 |
| Mean gain across samples | >= 15 |
| Per-dimension drop, every sample | <= 10 |
| Rewrite length | <= 2500 characters |

Current run: mean 31.3 → 81.2 (+49.8) over six samples, worst dimension change +6 (concision), all six samples pass.

The gate uses paired fixtures rather than live model calls so it is deterministic and runs without credentials. The live path is covered by `tests/host.test.mjs`, which drives the real route handlers against a fake provider stream.
