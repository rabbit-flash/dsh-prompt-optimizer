/**
 * Heuristic prompt-quality estimator.
 *
 * Shared by the Host routes (index.js) and the offline verifier, so the number a
 * user sees in the composer and the number a test asserts come from ONE code
 * path. Everything here is a deterministic ESTIMATE over surface features, not a
 * model judgement: same text in, same score out, on any machine.
 */

export const DIMENSIONS = [
  { id: 'structure', weight: 0.2, zh: '结构化', en: 'Structure' },
  { id: 'constraints', weight: 0.2, zh: '角色与约束', en: 'Role & constraints' },
  { id: 'context', weight: 0.15, zh: '上下文', en: 'Context' },
  { id: 'concise', weight: 0.15, zh: '精简', en: 'Concision' },
  { id: 'format', weight: 0.15, zh: '输出格式', en: 'Output format' },
  { id: 'examples', weight: 0.15, zh: '示例', en: 'Examples' }
]

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function countMatches(text, pattern) {
  const found = text.match(pattern)
  return found === null ? 0 : found.length
}

function structureScore(text) {
  let score = 15
  const notes = []
  if (/^#{1,6}[ \t]+\S/m.test(text)) {
    score += 25
    notes.push('Markdown 标题')
  }
  const bullets = countMatches(text, /^[ \t]*([-*+]|[0-9]+[.)])[ \t]+\S/gm)
  if (bullets >= 2) {
    score += 25
    notes.push(bullets + ' 条列表项')
  } else if (bullets === 1) {
    score += 10
    notes.push('1 条列表项')
  }
  const paragraphs = text.split(/\n[ \t]*\n/).filter(function (part) { return part.trim() !== '' }).length
  if (paragraphs >= 2) {
    score += 15
    notes.push(paragraphs + ' 段')
  }
  if (/^[ \t]*(任务|目标|背景|要求|约束|输出|步骤|Task|Goal|Context|Requirements|Constraints|Output|Steps)[ \t]*[:：]/im.test(text)) {
    score += 20
    notes.push('显式分区')
  }
  return { score: clamp(score), note: notes.join('、') || '无结构标记' }
}

function constraintsScore(text) {
  let score = 10
  const notes = []
  if (/(你是|你作为|作为一名|作为一个|扮演|You are|Act as|As an?)/i.test(text)) {
    score += 30
    notes.push('角色设定')
  }
  const hard = countMatches(text, /(必须|务必|一定要|禁止|严禁|不要|不得|不能|只输出|只返回|最多|至少|不超过|must|never|must not|do not|don't|only|at most|at least)/gi)
  if (hard >= 3) {
    score += 45
    notes.push(hard + ' 条硬性约束')
  } else if (hard === 2) {
    score += 30
    notes.push('2 条硬性约束')
  } else if (hard === 1) {
    score += 15
    notes.push('1 条硬性约束')
  }
  if (/(面向|读者|受众|语气|风格|口吻|audience|tone|voice|style)/i.test(text)) {
    score += 20
    notes.push('语气/受众')
  }
  return { score: clamp(score), note: notes.join('、') || '无角色或约束' }
}

function contextScore(text) {
  let score = 5
  const notes = []
  if (/(背景|上下文|现状|目前|当前|因为我们|由于|已经|background|context|currently|because|we are)/i.test(text)) {
    score += 35
    notes.push('交代背景')
  }
  if (/(Python|JavaScript|TypeScript|React|Vue|Java|Go|SQL|API|HTTP|接口|数据库|测试|代码库|仓库|函数|组件|业务|模型|插件)/i.test(text)) {
    score += 30
    notes.push('技术/业务语境')
  }
  if (/(为了|目的|希望|目标|以便|so that|in order to|goal|aim)/i.test(text)) {
    score += 30
    notes.push('说明目的')
  }
  return { score: clamp(score), note: notes.join('、') || '缺背景与目的' }
}

/**
 * Concision measures DENSITY, not brevity: a long prompt that states context,
 * rules and output is not "unconcise". Only padding is penalised — filler and
 * hedging words, restated sentences, character spam, and unbounded length.
 */
function conciseScore(text) {
  let score = 100
  const notes = []
  const chars = Array.from(text.trim()).length
  const filler = countMatches(text, /(那个|就是说|然后呢|反正|其实吧|嗯嗯|之类的|什么的|差不多|大概吧|basically|sort of|kind of|just really|literally|i guess|or something)/gi)
  if (filler > 0) {
    score -= Math.min(30, filler * 10)
    notes.push('填充词 ' + filler + ' 处')
  }
  const hedges = countMatches(text, /(帮我看看|能不能|你看|随便|whatever|help me out|somehow)/gi)
  if (hedges > 0) {
    score -= Math.min(15, hedges * 5)
    notes.push('模糊请求 ' + hedges + ' 处')
  }
  const runs = countMatches(text, /(.)\1{4,}/g)
  if (runs > 0) {
    score -= Math.min(20, runs * 10)
    notes.push('重复字符 ' + runs + ' 处')
  }
  const sentences = text.split(/[。！？.!?\n]+/).map(function (item) { return item.trim() }).filter(function (item) { return item.length > 3 })
  const seen = {}
  let duplicates = 0
  for (const sentence of sentences) {
    if (seen[sentence] === true) duplicates += 1
    seen[sentence] = true
  }
  if (duplicates > 0) {
    score -= Math.min(20, duplicates * 10)
    notes.push('重复句子 ' + duplicates + ' 处')
  }
  const emptyLines = countMatches(text, /\n[ \t]*\n[ \t]*\n/g)
  if (emptyLines > 0) {
    score -= Math.min(10, emptyLines * 5)
    notes.push('连续空行 ' + emptyLines + ' 处')
  }
  if (chars > 2500) {
    score -= chars > 4000 ? 30 : 15
    notes.push('篇幅过长 ' + chars + ' 字')
  }
  if (notes.length === 0) notes.push('无冗余，密度良好')
  return { score: clamp(score), note: notes.join('、') }
}

function formatScore(text) {
  let score = 0
  const notes = []
  if (/(输出|返回|给出|output|return|respond with|answer with)/i.test(text)) {
    score += 30
    notes.push('要求输出')
  }
  if (/(JSON|Markdown|CSV|XML|YAML|表格|列表|分段|代码块|json|markdown|table|bullet)/i.test(text)) {
    score += 40
    notes.push('指定格式')
  }
  if (/(不超过|以内|字以内|条以内|words|characters|chars|paragraphs|items)/i.test(text)) {
    score += 30
    notes.push('限定长度')
  }
  return { score: clamp(score), note: notes.join('、') || '未约定输出格式' }
}

function examplesScore(text) {
  let score = 0
  const notes = []
  if (/(示例|样例|例子|例如|举例|参考格式|example|e\.g\.|such as|for instance|sample)/i.test(text)) {
    score += 60
    notes.push('提及示例')
  }
  if (/\u0060\u0060\u0060/.test(text) || /[“"][^”"]{8,}[”"]/.test(text)) {
    score += 40
    notes.push('含样例片段')
  }
  return { score: clamp(score), note: notes.join('、') || '无示例' }
}

const SCORERS = {
  structure: structureScore,
  constraints: constraintsScore,
  context: contextScore,
  concise: conciseScore,
  format: formatScore,
  examples: examplesScore
}

/**
 * Score one prompt.
 * @param {string} text - the prompt text to estimate.
 * @returns {{ total: number, dimensions: Array<{ id: string, score: number, note: string }>, chars: number, estTokens: number }}
 */
export function scorePrompt(text) {
  const source = typeof text === 'string' ? text : ''
  const dimensions = []
  let total = 0
  for (const dimension of DIMENSIONS) {
    const result = SCORERS[dimension.id](source)
    dimensions.push({ id: dimension.id, score: result.score, note: result.note })
    total += result.score * dimension.weight
  }
  const chars = Array.from(source.trim()).length
  return {
    total: clamp(total),
    dimensions: dimensions,
    chars: chars,
    estTokens: Math.max(1, Math.round(chars / 2))
  }
}
