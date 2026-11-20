/**
 * Host half of dsh-prompt-optimizer.
 *
 * Two jobs, both behind the same loopback trust fence the shipped plugins use:
 *   1. POST /api/prompt-optimizer/optimize rewrites one draft through the
 *      CURRENT session's model, using ctx.llm.stream — the only supported path
 *      into a provider adapter.
 *   2. POST /api/prompt-optimizer/score returns the heuristic before/after
 *      estimate so the Client can draw the comparison without shipping a second
 *      copy of the scorer.
 *
 * The draft write itself never crosses this boundary: the Client already holds
 * inputActions.setDraft, so the Host returns text and the composer applies it.
 */
import { buildOptimizeRequest, parseOptimizeResult, normalizeGoals } from './lib/prompt.js'
import { scorePrompt } from './lib/score.js'

/** Route paths; the Client bundle mirrors these literals. */
export const ROUTES = {
  optimize: '/api/prompt-optimizer/optimize',
  score: '/api/prompt-optimizer/score',
  health: '/api/prompt-optimizer/health'
}

/** Largest accepted request body: a long draft plus JSON envelope. */
const BODY_MAX_BYTES = 512 * 1024

/** JSON response headers shared by every route. */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer'
}

function writeJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

function isIPv4Loopback(value) {
  const parts = value.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(function (part) {
    return /^\d{1,3}$/.test(part) && Number(part) <= 255
  })
}

function isLoopbackAddress(address) {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice(7))
  return isIPv4Loopback(normalized)
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return isIPv4Loopback(hostname)
}

/**
 * Whether a proxy stood between the browser and this Host: either forwarding
 * header is stamped by a hop that forwards traffic.
 */
function isProxiedRequest(request) {
  return request.headers['cf-connecting-ip'] !== undefined || request.headers['x-forwarded-for'] !== undefined
}

/**
 * Request trust fence: loopback socket AND loopback Host header, no forwarding
 * header, and same-origin browser markers. A proxy header is never evidence
 * FOR loopback.
 */
function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket.remoteAddress)) return false
  if (isProxiedRequest(request)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch (error) {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch (error) {
    return false
  }
}

/** Read one JSON request body, bounded by BODY_MAX_BYTES. */
function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = []
    let size = 0
    let settled = false
    const fail = function (error) {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', function (chunk) {
      if (settled) return
      size += chunk.length
      if (size > BODY_MAX_BYTES) {
        fail(new Error('request body exceeds ' + String(BODY_MAX_BYTES) + ' bytes'))
        return
      }
      chunks.push(chunk)
    })
    req.on('error', fail)
    req.on('end', function () {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(raw)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch (error) {
        reject(new Error('request body is not valid JSON'))
      }
    })
  })
}

/**
 * Resolve the model route for one session: the session's own current choice
 * first (that is what the user sees in the picker), then the deployment
 * default. Returns undefined when neither source names both halves.
 */
function resolveRoute(ctx, sessionId) {
  const complete = function (selection) {
    if (selection === undefined || selection === null) return undefined
    if (typeof selection.provider !== 'string' || selection.provider === '') return undefined
    if (typeof selection.model !== 'string' || selection.model === '') return undefined
    return {
      provider: selection.provider,
      model: selection.model,
      reasoningEffort: typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : undefined
    }
  }
  if (typeof sessionId === 'string' && sessionId !== '') {
    try {
      const agents = ctx.get('agents', false)
      const agent = agents !== undefined && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
      const model = agent !== undefined ? agent.model : undefined
      const picked = model !== undefined && typeof model.current === 'function' ? model.current() : undefined
      const route = complete(picked)
      if (route !== undefined) return route
    } catch (error) {
      // A missing agent registry keeps the deployment default in play.
    }
  }
  try {
    const defaults = ctx.get('agentDefaultModel', false)
    if (defaults !== undefined && typeof defaults.currentSelection === 'function') return complete(defaults.currentSelection())
  } catch (error) {
    return undefined
  }
  return undefined
}

/** Stream one one-shot completion and return its text plus any terminal failure. */
async function completeOnce(ctx, route, request) {
  let text = ''
  let failure
  const options = {
    provider: route.provider,
    model: route.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
    system: request.system
  }
  if (route.reasoningEffort !== undefined) options.reasoningEffort = route.reasoningEffort
  for await (const chunk of ctx.llm.stream(options)) {
    if (chunk.type === 'text-delta') {
      text += chunk.text
      continue
    }
    if (chunk.type === 'finish' && chunk.reason.kind !== 'stop') failure = chunk.reason.failure
  }
  return { text: text, failure: failure }
}

/**
 * Mount the routes.
 * @param ctx - host plugin context carrying webServer and llm.
 * @param config - resolved plugin config.
 */
function apply(ctx, config) {
  if (config !== null && typeof config === 'object' && config.enabled === false) return

  const guard = function (req, res, method) {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: 'method not allowed: ' + String(req.method) })
      return false
    }
    return true
  }

  const routes = [
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: function (req, res) {
        if (!guard(req, res, 'GET')) return
        const route = resolveRoute(ctx, undefined)
        writeJson(res, 200, {
          ok: true,
          provider: route === undefined ? null : route.provider,
          model: route === undefined ? null : route.model
        })
      }
    },
    {
      kind: 'exact',
      path: ROUTES.score,
      handler: async function (req, res) {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const before = scorePrompt(typeof body.before === 'string' ? body.before : '')
          const after = body.after === undefined ? null : scorePrompt(typeof body.after === 'string' ? body.after : '')
          writeJson(res, 200, { before: before, after: after })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      }
    },
    {
      kind: 'exact',
      path: ROUTES.optimize,
      handler: async function (req, res) {
        if (!guard(req, res, 'POST')) return
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          return
        }
        const source = typeof body.text === 'string' ? body.text.trim() : ''
        if (source === '') {
          writeJson(res, 400, { error: 'text is required' })
          return
        }
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
        const route = resolveRoute(ctx, sessionId)
        if (route === undefined) {
          writeJson(res, 409, { error: 'no model route: select a model in this session first' })
          return
        }
        const request = buildOptimizeRequest({
          text: source,
          goals: body.goals,
          locale: body.locale === 'en' ? 'en' : 'zh'
        })
        try {
          const result = await completeOnce(ctx, route, request)
          if (result.failure !== undefined) {
            writeJson(res, 502, {
              error: result.failure.message === undefined ? 'model call failed' : result.failure.message,
              code: result.failure.code === undefined ? null : result.failure.code
            })
            return
          }
          const parsed = parseOptimizeResult(result.text)
          if (parsed.optimized === '') {
            writeJson(res, 502, { error: 'model returned an empty rewrite', code: 'EMPTY_RESULT' })
            return
          }
          writeJson(res, 200, {
            optimized: parsed.optimized,
            changes: parsed.changes,
            goals: normalizeGoals(body.goals),
            provider: route.provider,
            model: route.model,
            before: scorePrompt(source),
            after: scorePrompt(parsed.optimized)
          })
        } catch (error) {
          ctx.logger.warn(error)
          writeJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
        }
      }
    }
  ]

  ctx.effect(function () {
    const disposers = routes.map(function (route) { return ctx.webServer.register(route) })
    return function () {
      for (const dispose of disposers) dispose()
    }
  }, 'prompt-optimizer: routes')
}

export const name = 'prompt-optimizer'
export const inject = ['webServer', 'llm']
export { apply }
export default { name: name, inject: inject, apply: apply }
