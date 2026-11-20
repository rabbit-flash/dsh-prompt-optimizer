/**
 * The optimization instruction and the tolerant reader for the model's reply.
 *
 * One place builds the request so the Host route and the offline verifier send
 * the same instruction, and one reader accepts the JSON the model is asked for
 * without trusting it to be well formed.
 */

export const GOAL_TEXT = {
  zh: {
    structure: '用标题/列表/分段把任务、背景、要求、输出分区，条理化',
    constraints: '补一个合适的角色设定，并把必须/禁止/边界写成硬性约束',
    context: '补足完成任务所必需的背景、技术语境与目的，但不得编造事实',
    concise: '删掉口语填充、重复与自我重复，在同等信息量下取最短表达',
    format: '明确要求输出格式、长度与结构',
    examples: '补 1-2 个输入/输出示例（可为占位），说明期望形态'
  },
  en: {
    structure: 'Partition the prompt into task, context, requirements and output with headings, lists or paragraphs',
    constraints: 'Add a fitting role and turn must/never/boundary rules into hard constraints',
    context: 'Supply the background, technical context and purpose the task needs, without inventing facts',
    concise: 'Remove filler, repetition and restatement, keeping the shortest text with the same information',
    format: 'State the required output format, length and structure',
    examples: 'Add one or two input/output examples (placeholders are fine) showing the expected shape'
  }
}

const GOAL_IDS = Object.keys(GOAL_TEXT.zh)

/** Narrow an incoming goal list to known ids; an empty or absent list means every goal. */
export function normalizeGoals(goals) {
  if (!Array.isArray(goals)) return GOAL_IDS.slice()
  const picked = GOAL_IDS.filter(function (id) { return goals.indexOf(id) !== -1 })
  return picked.length === 0 ? GOAL_IDS.slice() : picked
}

/**
 * Build the one-shot request that rewrites a prompt.
 * @param {{ text: string, goals?: string[], locale?: string }} input
 * @returns {{ system: string, user: string, goals: string[], locale: string }}
 */
export function buildOptimizeRequest(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const text = typeof source.text === 'string' ? source.text : ''
  const goals = normalizeGoals(source.goals)
  const locale = source.locale === 'en' ? 'en' : 'zh'
  const list = goals.map(function (id) { return '- ' + GOAL_TEXT[locale][id] }).join('\n')
  const system = [
    'You are a prompt engineer. Rewrite the user prompt so a model can act on it with less ambiguity.',
    'Rules:',
    '1. Keep the original intent, language, names, numbers, code, file paths and URLs verbatim; never answer the prompt itself.',
    '2. Improve only the requested dimensions. Never invent facts, credentials, or file contents.',
    '3. Keep it as short as the goals allow, and put no meta commentary inside the rewritten prompt.',
    '4. Reply with ONE JSON object and nothing else: {"optimized": string, "changes": string[]}.',
    '   "optimized" is the rewritten prompt; "changes" holds 2-5 short bullets in the prompt language.'
  ].join('\n')
  const user = [
    '# Improve the prompt on these dimensions',
    list,
    '',
    '# Original prompt',
    '<<<',
    text,
    '>>>',
    '',
    '# Output',
    'Return only the JSON object described in the system message.'
  ].join('\n')
  return { system: system, user: user, goals: goals, locale: locale }
}

/**
 * Read the model's reply: prefer the JSON contract, fall back to the plain text.
 * @param {string} raw - the model output.
 * @returns {{ optimized: string, changes: string[] }}
 */
export function parseOptimizeResult(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      const candidate = typeof parsed.optimized === 'string' ? parsed.optimized : typeof parsed.prompt === 'string' ? parsed.prompt : ''
      const optimized = candidate.trim()
      if (optimized !== '') {
        const changes = Array.isArray(parsed.changes)
          ? parsed.changes.filter(function (item) { return typeof item === 'string' && item.trim() !== '' }).slice(0, 6)
          : []
        return { optimized: optimized, changes: changes }
      }
    } catch (error) {
      // Fall through to the plain-text reader below.
    }
  }
  const fenced = text.replace(/\u0060\u0060\u0060[a-zA-Z]*\n?/g, '').trim()
  return { optimized: fenced, changes: [] }
}
