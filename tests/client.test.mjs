// Headless smoke test of the browser half. react-dom is not installed in this
// profile, so client.js is driven through a minimal React shim and the returned
// element trees are inspected directly.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
}

const styleTags = []
const document = {
  documentElement: { getAttribute: (name) => (name === 'lang' ? 'zh' : null) },
  head: { appendChild: (node) => styleTags.push(node) },
  getElementById: (id) => styleTags.find((node) => node.id === id) ?? null,
  createElement: () => ({ id: '', textContent: '' })
}

const React = {
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props)
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  },
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useEffect() {},
  useMemo(fn) {
    return fn()
  },
  useCallback(fn) {
    return fn
  }
}

let registered = null
const window = {
  __ModuleLoader__: {
    load(options) {
      registered = options
    }
  }
}

const sandbox = {
  window,
  document,
  console: { error() {}, log() {}, warn() {} },
  fetch: () => Promise.reject(new Error('fetch not stubbed')),
  AbortController,
  setTimeout: (fn, ms) => {
    const timer = setTimeout(fn, ms)
    if (timer !== null && typeof timer.unref === 'function') timer.unref()
    return timer
  },
  clearTimeout,
  JSON,
  Object,
  Array,
  String,
  Number,
  Math,
  Error,
  Promise,
  Map,
  Set
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

check('module loader called', registered !== null && registered.id === 'dsh-prompt-optimizer')

const slotRegistrations = []
const localeCalls = []
const localeDict = {}
const ctx = {
  effect(fn) {
    const disposer = fn()
    return () => { if (typeof disposer === 'function') disposer() }
  },
  locale: {
    register: (ns, dict) => { localeCalls.push({ ns, dict }); return () => {} },
    bind: (ns) => (key) => localeDict[ns]?.[key]
  },
  get(name) {
    if (name === 'locale') {
      return {
        register: (ns, dict) => { localeCalls.push({ ns, dict }) },
        bind: () => () => undefined
      }
    }
    return undefined
  },
  slots: {
    inject(owner, factory) {
      return factory()
    },
    register(config, component) {
      slotRegistrations.push({ config, component })
      return () => {}
    }
  }
}

const mod = registered.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
mod.apply(ctx)

check('style injected once', styleTags.length === 1 && styleTags[0].id === 'dsh-prompt-optimizer-style', 'count=' + String(styleTags.length))
check('locale registered with zh and en', localeCalls.length === 1 && localeCalls[0].ns === 'dsh-prompt-optimizer' && typeof localeCalls[0].dict.zh === 'object' && typeof localeCalls[0].dict.en === 'object')
check('both locales share the same keys', JSON.stringify(Object.keys(localeCalls[0].dict.zh).sort()) === JSON.stringify(Object.keys(localeCalls[0].dict.en).sort()))
check('two slots registered', slotRegistrations.length === 2, slotRegistrations.map((r) => r.config.name).join(','))

const bySlot = {}
for (const item of slotRegistrations) bySlot[item.config.name] = item.component
const buttonSlot = bySlot['conversation.input.right']
const panelSlot = bySlot['conversation.composer.dock']
check('button registered in composer right row', typeof buttonSlot === 'function')
check('panel registered in composer dock', typeof panelSlot === 'function')

// Slot occupants are wrappers around the real components; render one level so
// the returned element is the actual <button> / <div> tree.
function render(node) {
  let current = node
  for (let depth = 0; depth < 10; depth += 1) {
    if (current === null || current === undefined) return null
    if (typeof current !== 'object' || typeof current.type !== 'function') return current
    current = current.type(current.props)
  }
  return current
}
const Button = (props) => render(buttonSlot(props))
const Panel = (props) => render(panelSlot(props))

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'object') {
    if (typeof node.type === 'function') return textOf(node.type(node.props))
    return textOf(node.props?.children)
  }
  return ''
}

function findAll(node, predicate, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, found)
    return found
  }
  if (predicate(node)) found.push(node)
  if (typeof node.type === 'function') findAll(node.type(node.props), predicate, found)
  else findAll(node.props?.children, predicate, found)
  return found
}

const buttons = (tree) => findAll(tree, (node) => node.type === 'button')
const buttonByText = (tree, text) => buttons(tree).filter((node) => textOf(node).includes(text))

const reply = JSON.stringify({
  optimized: '你是前端性能工程师。\n\n## 任务\n优化登录页首屏。\n\n## 要求\n- 必须给出 3 条改动\n- 禁止改后端接口\n\n## 输出\nMarkdown 列表。',
  changes: ['补充角色', '明确输出格式'],
  provider: 'ofm',
  model: 'trae/deepseek-v4.1-flash',
  before: { total: 41, chars: 30, estTokens: 15, dimensions: [{ id: 'structure', score: 20 }, { id: 'constraints', score: 10 }, { id: 'context', score: 35 }, { id: 'concise', score: 92 }, { id: 'format', score: 0 }, { id: 'examples', score: 0 }] },
  after: { total: 78, chars: 62, estTokens: 31, dimensions: [{ id: 'structure', score: 75 }, { id: 'constraints', score: 70 }, { id: 'context', score: 65 }, { id: 'concise', score: 80 }, { id: 'format', score: 70 }, { id: 'examples', score: 0 }] }
})

const calls = { setDraft: [], persistDraft: 0, posts: [] }
const actions = {
  setDraft: (text) => calls.setDraft.push(text),
  persistDraft: () => { calls.persistDraft += 1 }
}
const state = (draft, phase) => (selector) => selector({ draft, phase: phase ?? 'plain' })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// 1. empty draft -> explanatory notice, no request
{
  sandbox.fetch = () => { throw new Error('must not fetch') }
  const tree = Button({ sessionId: 'empty-1', useInput: state('   '), inputActions: actions })
  check('empty draft keeps the button clickable', tree.props.disabled === false)
  await tree.props.onClick()
  const panel = Panel({ sessionId: 'empty-1', useInput: state(''), inputActions: actions })
  check('empty draft shows a notice', textOf(panel).includes('草稿为空'), textOf(panel))
}

// 2. sending phase -> busy notice
{
  const tree = Button({ sessionId: 'busy-1', useInput: state('hello', 'submitting'), inputActions: actions })
  await tree.props.onClick()
  const panel = Panel({ sessionId: 'busy-1', useInput: state(''), inputActions: actions })
  check('busy phase shows a notice', textOf(panel).includes('正在处理中'), textOf(panel))
}

// 3. happy path: request, guarded write, comparison panel
const draft = '帮我看看登录页为啥这么慢 那个首屏要四秒多'
{
  sandbox.fetch = (path, options) => {
    calls.posts.push({ path, body: JSON.parse(options.body) })
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(reply) })
  }
  const tree = Button({ sessionId: 's1', useInput: state(draft), inputActions: actions })
  check('filled draft leaves the button enabled', tree.props.disabled === false)
  await tree.props.onClick()
  const pending = Panel({ sessionId: 's1', useInput: state(''), inputActions: actions })
  check('panel stays quiet while running', pending === null || textOf(pending) === '')
  await flush()
  check('posted to the optimize route', calls.posts.length === 1 && calls.posts[0].path === '/api/prompt-optimizer/optimize', String(calls.posts[0]?.path))
  check('posted the exact draft', calls.posts[0].body.text === draft)
  check('requested all six goals', Array.isArray(calls.posts[0].body.goals) && calls.posts[0].body.goals.length === 6, JSON.stringify(calls.posts[0]?.body?.goals))
  check('uses the page locale', calls.posts[0].body.locale === 'zh', calls.posts[0].body.locale)
  check('draft replaced with the rewrite', calls.setDraft.length === 1 && calls.setDraft[0].startsWith('你是前端性能工程师'), String(calls.setDraft[0]).slice(0, 30))
  check('draft persisted', calls.persistDraft === 1)

  const tree2 = Panel({ sessionId: 's1', useInput: state(''), inputActions: actions })
  const text = textOf(tree2)
  check('panel shows before and after totals', text.includes('41') && text.includes('78'))
  check('panel shows the total delta', text.includes('+37'))
  check('panel states the estimate caveat', text.includes('并非模型评判'))
  check('panel lists the changes', text.includes('补充角色'))
  check('panel flags the regressed dimension', text.includes('下降'))
  check('panel shows six dimension labels', ['结构化', '角色与约束', '背景上下文', '精简', '输出格式', '示例'].every((label) => text.includes(label)))
  const fills = findAll(tree2, (node) => node.props?.className === 'po-fill')
  check('one bar per dimension', fills.length === 6, String(fills.length))
  const bars = findAll(tree2, (node) => node.props?.role === 'progressbar')
  check('bars expose aria values', bars.length === 6 && bars[0].props['aria-valuenow'] === 75, String(bars[0]?.props?.['aria-valuenow']))
  const undo = buttonByText(tree2, '恢复原文')
  check('restore button present', undo.length === 1)
  undo[0].props.onClick()
  check('restore puts the original back', calls.setDraft.length === 2 && calls.setDraft[1] === draft, String(calls.setDraft[1]))
  check('restore hides the panel', Panel({ sessionId: 's1', useInput: state(''), inputActions: actions }) === null)
}

// 4. typing during the request must not be clobbered
{
  let release
  const gate = new Promise((resolve) => { release = resolve })
  sandbox.fetch = () => gate.then(() => ({ ok: true, status: 200, text: () => Promise.resolve(reply) }))
  const before = calls.setDraft.length
  const tree = Button({ sessionId: 's3', useInput: state('原始草稿'), inputActions: actions })
  await tree.props.onClick()
  Button({ sessionId: 's3', useInput: state('我在此期间的修改'), inputActions: actions })
  release()
  await flush()
  check('edited draft is not overwritten', calls.setDraft.length === before, String(calls.setDraft.length))
  const panel = Panel({ sessionId: 's3', useInput: state('我在此期间的修改'), inputActions: actions })
  const text = textOf(panel)
  check('panel explains the pending rewrite', text.includes('改写未自动写入'), text.slice(0, 160))
  const apply = buttonByText(panel, '应用改写')
  const keep = buttonByText(panel, '保留我的')
  check('explicit apply offered', apply.length === 1)
  check('explicit keep offered', keep.length === 1)
  apply[0].props.onClick()
  check('apply writes the rewrite on demand', calls.setDraft.length === before + 1, String(calls.setDraft.length))
  keep[0].props.onClick()
  check('keep mine hides without writing', Panel({ sessionId: 's3', useInput: state(''), inputActions: actions }) === null)
}

// 5. failure keeps the draft and reports the reason
{
  sandbox.fetch = () => Promise.resolve({ ok: false, status: 502, text: () => Promise.resolve(JSON.stringify({ error: 'model returned an empty rewrite', code: 'EMPTY_RESULT' })) })
  const before = calls.setDraft.length
  const tree = Button({ sessionId: 's2', useInput: state('x  prompt'), inputActions: actions })
  await tree.props.onClick()
  await flush()
  const panel = Panel({ sessionId: 's2', useInput: state(''), inputActions: actions })
  const text = textOf(panel)
  check('failure does not touch the draft', calls.setDraft.length === before, String(calls.setDraft.length))
  check('failure is reported', text.includes('优化失败') && text.includes('empty rewrite'), text.slice(0, 140))
}

// 6. panel is silent before any run, and running state disables the button
{
  check('idle panel renders nothing', Panel({ sessionId: 'never', useInput: state(''), inputActions: actions }) === null)
  sandbox.fetch = () => new Promise(() => {})
  const tree = Button({ sessionId: 's4', useInput: state('abc'), inputActions: actions })
  await tree.props.onClick()
  const again = Button({ sessionId: 's4', useInput: state('abc'), inputActions: actions })
  check('running state disables the button', again.props.disabled === true && again.props['aria-busy'] === 'true')
}

// 7. style hygiene
{
  const css = styleTags[0].textContent
  const literals = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)
  check('no literal colors in css', literals === null, literals ? literals.slice(0, 5).join(',') : 'none')
  const tokens = css.match(/var\(--dsw-alias-[a-z0-9-]+\)/g) ?? []
  check('uses theme tokens only', tokens.length > 10, String(tokens.length))
  const foreign = css.match(/var\(--(?!dsw-alias-)[a-z0-9-]+\)/g)
  check('no non-theme custom properties', foreign === null, foreign ? foreign.slice(0, 4).join(',') : 'none')
  check('focus-visible styling present', css.includes(':focus-visible'))
  check('reduced motion honoured', css.includes('prefers-reduced-motion'))
}

const failed = results.filter((item) => !item.ok)
for (const item of results) console.log((item.ok ? 'PASS ' : 'FAIL ') + item.name + (item.ok ? '' : ' :: ' + String(item.detail ?? '')))
console.log('')
console.log(String(results.length - failed.length) + '/' + String(results.length) + ' checks passed')
if (failed.length > 0) process.exitCode = 1
