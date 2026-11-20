// Offline verification of the Host half: fake ctx, fake req/res, real handlers.
import { apply, ROUTES } from '../index.js'
import { scorePrompt } from '../lib/score.js'
import { Readable } from 'node:stream'

function fakeCtx(replyText) {
  const routes = []
  const ctx = {
    routes: routes,
    streamCalls: [],
    effect(fn) { const dispose = fn(); return dispose },
    get(name) {
      if (name === 'agents') return { get: () => undefined }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'ofm', model: 'trae/deepseek-v4.1-flash' }) }
      return undefined
    },
    webServer: { register(route) { routes.push(route); return () => {} } },
    logger: { warn() {} },
    llm: {
      async *stream(options) {
        ctx.streamCalls.push(options)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: replyText }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  return ctx
}

function fakeReq(body, options) {
  const source = JSON.stringify(body ?? {})
  const req = Readable.from([Buffer.from(source, 'utf8')])
  req.method = (options && options.method) || 'POST'
  req.headers = Object.assign({
    host: '127.0.0.1:57823',
    'content-type': 'application/json'
  }, (options && options.headers) || {})
  req.socket = { remoteAddress: (options && options.remoteAddress) || '127.0.0.1' }
  return req
}

function fakeRes() {
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { res.status = status; res.headers = headers || {}; return res },
    end(payload) { res.body = payload === undefined ? '' : String(payload); return res }
  }
  return res
}

const results = []
function check(name, condition, detail) {
  results.push({ name: name, ok: Boolean(condition), detail: detail })
}

const reply = JSON.stringify({
  optimized: '你是资深前端工程师。任务：优化登录页首屏性能。\n\n## 背景\n现有 React 应用首屏 4.1s。\n\n## 要求\n- 必须给出 3 条可执行改动\n- 禁止改动后端接口\n\n## 输出\nMarkdown 列表，不超过 300 字。',
  changes: ['补充角色', '补背景数据', '明确输出格式']
})

const ctx = fakeCtx(reply)
apply(ctx, {})
check('two routes registered', ctx.routes.length === 3, ctx.routes.map((r) => r.path).join(','))

const byPath = {}
for (const route of ctx.routes) byPath[route.path] = route

const draft = '帮我看看登录页为啥这么慢 那个首屏要四秒多 反正好慢 然后呢我想优化一下'

// 1. non-loopback socket is refused
{
  const res = fakeRes()
  await byPath[ROUTES.optimize].handler(fakeReq({ text: draft }, { remoteAddress: '192.168.1.20' }), res)
  check('remote socket rejected', res.status === 403 && JSON.parse(res.body).error === 'forbidden: loopback-only', res.status + ' ' + res.body)
}

// 2. proxied request is refused
{
  const res = fakeRes()
  await byPath[ROUTES.optimize].handler(fakeReq({ text: draft }, { headers: { 'x-forwarded-for': '10.0.0.2' } }), res)
  check('proxied request rejected', res.status === 403, res.status + ' ' + res.body)
}

// 3. cross-site browser marker is refused
{
  const res = fakeRes()
  await byPath[ROUTES.optimize].handler(fakeReq({ text: draft }, { headers: { 'sec-fetch-site': 'cross-site' } }), res)
  check('cross-site rejected', res.status === 403, res.status + ' ' + res.body)
}

// 4. wrong method is refused
{
  const res = fakeRes()
  await byPath[ROUTES.optimize].handler(fakeReq({ text: draft }, { method: 'GET' }), res)
  check('wrong method rejected', res.status === 405, res.status + ' ' + res.body)
}

// 5. empty text is a 400
{
  const res = fakeRes()
  await byPath[ROUTES.optimize].handler(fakeReq({ text: '   ' }), res)
  check('empty text rejected', res.status === 400, res.status + ' ' + res.body)
}

// 6. happy path
let happy
{
  const res = fakeRes()
  await byPath[ROUTES.optimize].handler(fakeReq({ text: draft, sessionId: 'session-1', locale: 'zh' }), res)
  happy = JSON.parse(res.body)
  check('optimize returns 200', res.status === 200, res.status + ' ' + res.body.slice(0, 200))
  check('optimized text present', typeof happy.optimized === 'string' && happy.optimized.length > 0, happy.optimized && happy.optimized.slice(0, 60))
  check('changes parsed', Array.isArray(happy.changes) && happy.changes.length === 3, JSON.stringify(happy.changes))
  check('before and after scored', happy.before && happy.after && typeof happy.before.total === 'number' && typeof happy.after.total === 'number', JSON.stringify({ before: happy.before && happy.before.total, after: happy.after && happy.after.total }))
  check('score improved', happy.after.total > happy.before.total, String(happy.before.total) + ' -> ' + String(happy.after.total))
  check('route reported', happy.provider === 'ofm' && happy.model === 'trae/deepseek-v4.1-flash', happy.provider + '/' + happy.model)
  check('request used system prompt', ctx.streamCalls.length === 1 && typeof ctx.streamCalls[0].system === 'string' && ctx.streamCalls[0].system.includes('prompt engineer'), String(ctx.streamCalls.length))
  check('user message carries the draft', ctx.streamCalls[0].messages[0].content[0].text.includes(draft), 'ok')
}

// 7. score endpoint
{
  const res = fakeRes()
  await byPath[ROUTES.score].handler(fakeReq({ before: draft, after: happy.optimized }), res)
  const payload = JSON.parse(res.body)
  check('score endpoint matches scorer', payload.before.total === happy.before.total && payload.after.total === happy.after.total, JSON.stringify({ a: payload.before.total, b: payload.after.total }))
  check('six dimensions returned', payload.before.dimensions.length === 6, String(payload.before.dimensions.length))
}

// 8. health endpoint
{
  const res = fakeRes()
  await byPath[ROUTES.health].handler(fakeReq({}, { method: 'GET' }), res)
  const payload = JSON.parse(res.body)
  check('health reports route', payload.ok === true && payload.provider === 'ofm', res.body)
}

// 9. provider failure surfaces as 502
{
  const failing = fakeCtx('')
  failing.llm.stream = async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'rate limited' } } } }
  apply(failing, {})
  const failPath = {}
  for (const route of failing.routes) failPath[route.path] = route
  const res = fakeRes()
  await failPath[ROUTES.optimize].handler(fakeReq({ text: draft }), res)
  const payload = JSON.parse(res.body)
  check('provider failure is 502', res.status === 502 && payload.code === 'RATE_LIMIT', res.status + ' ' + res.body)
}

// 10. scorer is deterministic and bounded
{
  const a = scorePrompt(draft)
  const b = scorePrompt(draft)
  check('scorer deterministic', JSON.stringify(a) === JSON.stringify(b), 'ok')
  check('scorer bounded 0..100', a.total >= 0 && a.total <= 100 && a.dimensions.every((d) => d.score >= 0 && d.score <= 100), String(a.total))
  const padded = scorePrompt('   ' + draft + '   ')
  check('scorer trims padding', padded.total === a.total, String(padded.total))
}

const failed = results.filter((item) => !item.ok)
for (const item of results) console.log((item.ok ? 'PASS ' : 'FAIL ') + item.name + (item.ok ? '' : ' :: ' + String(item.detail)))
console.log('')
console.log(String(results.length - failed.length) + '/' + String(results.length) + ' checks passed')
if (failed.length > 0) process.exitCode = 1
