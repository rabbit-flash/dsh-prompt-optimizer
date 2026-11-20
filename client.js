/**
 * Client half of dsh-prompt-optimizer.
 *
 * Two slot occupants:
 *  - conversation.input.right  -> one compact "optimize" control, rendered just
 *    before the model picker; it rewrites the composer draft through the Host.
 *  - conversation.composer.dock -> the before/after comparison, rendered as a
 *    full-width row under the input bar (no popover, no portal).
 *
 * Safety rules this file is built around:
 *  - the draft is only overwritten when it still equals the text that was sent
 *    (typed-while-optimizing is never silently destroyed);
 *  - closing the comparison hides it but keeps the original text recoverable;
 *  - a disabled-looking control is avoided: clicking always explains itself.
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-optimizer',
  factory(require) {
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useCallback = React.useCallback
    var useMemo = React.useMemo

    var NS = 'dsh-prompt-optimizer'
    var ROUTES = {
      optimize: '/api/prompt-optimizer/optimize',
      score: '/api/prompt-optimizer/score',
      health: '/api/prompt-optimizer/health'
    }
    var DIMENSIONS = ['structure', 'constraints', 'context', 'concise', 'format', 'examples']
    var ALL_GOALS = DIMENSIONS.slice()
    var REQUEST_TIMEOUT_MS = 120000

    var CSS = [
      '.po-root{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);}',
      '.po-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer;transition:background .15s ease,color .15s ease;}',
      '.po-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.po-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
      '.po-btn:disabled{opacity:.5;cursor:progress;}',
      '.po-btn.ghost{border-color:transparent;}',
      '.po-btn.tint{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
      '.po-spin{display:inline-block;width:11px;height:11px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:po-rot .8s linear infinite;}',
      '@keyframes po-rot{to{transform:rotate(360deg);}}',
      '@media (prefers-reduced-motion: reduce){.po-spin{animation:none;}.po-fill{transition:none;}}',
      '.po-panel{margin-top:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;max-height:320px;overflow:auto;overflow-wrap:anywhere;}',
      '.po-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}',
      '.po-title{font-size:13px;font-weight:600;}',
      '.po-spacer{flex:1 1 auto;}',
      '.po-note{color:var(--dsw-alias-label-secondary);font-size:11px;}',
      '.po-caveat{color:var(--dsw-alias-label-secondary);font-size:11px;margin-bottom:10px;}',
      '.po-score{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}',
      '.po-num{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.1;}',
      '.po-num.muted{color:var(--dsw-alias-label-secondary);font-size:16px;font-weight:500;}',
      '.po-arrow{color:var(--dsw-alias-label-secondary);}',
      '.po-chip{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:9px;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;border:1px solid transparent;}',
      '.po-chip.up{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}',
      '.po-chip.down{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}',
      '.po-chip.flat{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l1);}',
      '.po-dims{margin:10px 0 0;}',
      '.po-dim{display:grid;grid-template-columns:76px 1fr auto;gap:8px;align-items:center;}',
      '.po-dim + .po-dim{margin-top:6px;}',
      '.po-label{color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.po-track{position:relative;height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);}',
      '.po-fill{position:absolute;left:0;top:0;height:100%;border-radius:4px;background:var(--dsw-alias-brand-primary);transition:width .35s ease;}',
      '.po-mark{position:absolute;top:-2px;width:2px;height:12px;border-radius:1px;background:var(--dsw-alias-label-secondary);}',
      '.po-val{font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap;}',
      '.po-val .after{color:var(--dsw-alias-label-primary);font-weight:600;}',
      '.po-changes{margin:10px 0 0;padding-left:16px;max-height:88px;overflow:auto;}',
      '.po-changes li{margin:2px 0;}',
      '.po-actions{display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap;}',
      '.po-error{color:var(--dsw-alias-state-error-primary);}',
      '.po-warn{color:var(--dsw-alias-state-warn-primary);}'
    ].join('')

    var LABELS = {
      zh: {
        'button': '优化提示词',
        'buttonHint': '用当前会话模型改写草稿，并对比优化前后的估算得分',
        'running': '优化中…',
        'title': '提示词优化对比',
        'before': '优化前',
        'after': '优化后',
        'caveat': '估算值：按结构、约束、背景、简洁、格式、示例六项表面特征加权，并非模型评判，仅供参考。',
        'undo': '恢复原文',
        'hide': '隐藏',
        'changes': '本次改动',
        'failed': '优化失败',
        'chars': '字',
        'tokens': '≈token',
        'applyNow': '应用改写',
        'keepMine': '保留我的',
        'pendingHint': '优化期间草稿已被修改，改写未自动写入。',
        'noticeEmpty': '草稿为空，先写点内容再优化。',
        'noticeBusy': '当前消息正在处理中，等这一轮结束后再优化。',
        'regressed': '有 {n} 项下降',
        'dims.structure': '结构化',
        'dims.constraints': '角色与约束',
        'dims.context': '背景上下文',
        'dims.concise': '精简',
        'dims.format': '输出格式',
        'dims.examples': '示例'
      },
      en: {
        'button': 'Optimize prompt',
        'buttonHint': 'Rewrite the draft with this session model and compare estimated scores',
        'running': 'Optimizing…',
        'title': 'Prompt optimization',
        'before': 'Before',
        'after': 'After',
        'caveat': 'Estimated: a weighted score over six surface features (structure, rules, context, concision, format, examples). Not a model judgement.',
        'undo': 'Restore original',
        'hide': 'Hide',
        'changes': 'What changed',
        'failed': 'Optimization failed',
        'chars': 'chars',
        'tokens': '≈tokens',
        'applyNow': 'Apply rewrite',
        'keepMine': 'Keep mine',
        'pendingHint': 'You edited the draft while it was being optimized, so the rewrite was not written in.',
        'noticeEmpty': 'The draft is empty — write something first.',
        'noticeBusy': 'A message is being processed; optimize after this turn finishes.',
        'regressed': '{n} dimension(s) dropped',
        'dims.structure': 'Structure',
        'dims.constraints': 'Role & rules',
        'dims.context': 'Context',
        'dims.concise': 'Concision',
        'dims.format': 'Output format',
        'dims.examples': 'Examples'
      }
    }

    function pageLocale() {
      var lang = document.documentElement.getAttribute('lang') || ''
      return lang.toLowerCase().indexOf('en') === 0 ? 'en' : 'zh'
    }

    var store = {
      entries: new Map(),
      drafts: new Map(),
      listeners: new Set()
    }

    function emptyEntry() {
      return {
        status: 'idle',
        visible: false,
        before: null,
        after: null,
        changes: [],
        original: '',
        optimized: '',
        sentText: '',
        provider: '',
        model: '',
        goals: ALL_GOALS.slice(),
        error: '',
        notice: '',
        pendingApply: false
      }
    }

    function entryOf(sessionId) {
      var key = typeof sessionId === 'string' ? sessionId : ''
      var current = store.entries.get(key)
      return current === undefined ? emptyEntry() : current
    }

    function setEntry(sessionId, patch) {
      var key = typeof sessionId === 'string' ? sessionId : ''
      store.entries.set(key, Object.assign({}, entryOf(key), patch))
      store.listeners.forEach(function (listener) { listener() })
    }

    function useEntry(sessionId) {
      var value = useState(0)
      var bump = value[1]
      useEffect(function () {
        var listener = function () { bump(function (n) { return n + 1 }) }
        store.listeners.add(listener)
        return function () { store.listeners.delete(listener) }
      }, [])
      return entryOf(sessionId)
    }

    function ensureCss() {
      if (document.getElementById(NS + '-style') !== null) return
      var style = document.createElement('style')
      style.id = NS + '-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    function postJson(path, body) {
      var controller = new AbortController()
      var timer = setTimeout(function () { controller.abort() }, REQUEST_TIMEOUT_MS)
      return fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
        signal: controller.signal
      }).then(function (response) {
        return response.text().then(function (text) {
          var payload = {}
          if (text !== '') {
            try { payload = JSON.parse(text) } catch (error) { payload = { error: text.slice(0, 300) } }
          }
          if (!response.ok) {
            var message = typeof payload.error === 'string' ? payload.error : 'HTTP ' + String(response.status)
            var failure = new Error(message)
            failure.code = typeof payload.code === 'string' ? payload.code : ''
            throw failure
          }
          return payload
        })
      }).then(function (payload) {
        clearTimeout(timer)
        return payload
      }, function (error) {
        clearTimeout(timer)
        throw error
      })
    }

    function useLabels(ctx) {
      var value = useState(null)
      var setT = value[1]
      useEffect(function () {
        var locale = ctx === undefined || ctx === null || typeof ctx.get !== 'function' ? undefined : ctx.get('locale', false)
        if (locale === undefined || locale === null || typeof locale.bind !== 'function') return
        try { setT(function () { return locale.bind(NS) }) } catch (error) { setT(null) }
      }, [ctx])
      var t = value[0]
      var fallback = LABELS[pageLocale()]
      return useMemo(function () {
        return function (key, vars) {
          var live = t === null || t === undefined ? undefined : t(key)
          var text = typeof live === 'string' && live !== '' && live !== key ? live : fallback[key]
          if (typeof text !== 'string' || text === '') text = key
          if (vars !== undefined) {
            Object.keys(vars).forEach(function (name) {
              text = text.split('{' + name + '}').join(String(vars[name]))
            })
          }
          return text
        }
      }, [t, fallback])
    }

    function chipClass(delta) {
      if (delta > 0) return 'po-chip up'
      if (delta < 0) return 'po-chip down'
      return 'po-chip flat'
    }

    function chipText(delta) {
      if (delta > 0) return '+' + String(delta)
      return String(delta)
    }

    function detailOf(score, id) {
      if (score === null || score === undefined || !Array.isArray(score.dimensions)) return 0
      for (var i = 0; i < score.dimensions.length; i += 1) {
        if (score.dimensions[i].id === id) return score.dimensions[i].score
      }
      return 0
    }

    function Dimensions(props) {
      var t = props.t
      var rows = DIMENSIONS.map(function (id) {
        var oldValue = detailOf(props.before, id)
        var newValue = detailOf(props.after, id)
        var delta = newValue - oldValue
        return h('div', { className: 'po-dim', key: id },
          h('span', { className: 'po-label', title: t('dims.' + id) }, t('dims.' + id)),
          h('span', {
            className: 'po-track',
            role: 'progressbar',
            'aria-label': t('dims.' + id),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': newValue,
            'aria-valuetext': t('before') + ' ' + String(oldValue) + ', ' + t('after') + ' ' + String(newValue)
          },
            h('span', { className: 'po-fill', style: { width: String(newValue) + '%' } }),
            h('span', { className: 'po-mark', style: { left: 'calc(' + String(oldValue) + '% - 1px)' }, title: t('before') + ' ' + String(oldValue) })
          ),
          h('span', { className: 'po-val' },
            h('span', null, String(oldValue)),
            h('span', null, ' → '),
            h('span', { className: 'after' }, String(newValue)),
            h('span', { className: chipClass(delta), style: { marginLeft: '6px' } }, chipText(delta))
          )
        )
      })
      return h('div', { className: 'po-dims' }, rows)
    }

    function OptimizeButton(props) {
      var sessionId = props.sessionId
      var t = useLabels(props.ctx)
      var entry = useEntry(sessionId)
      var input = typeof props.useInput === 'function' ? props.useInput(function (state) { return state }) : undefined
      var actions = props.inputActions
      var draft = input === undefined || input === null || typeof input.draft !== 'string' ? '' : input.draft
      var phase = input === undefined || input === null ? 'plain' : input.phase
      var running = entry.status === 'running'

      // Keep the live draft reachable from the async reply handler.
      if (typeof sessionId === 'string') store.drafts.set(sessionId, draft)

      var onClick = useCallback(function () {
        if (running) return
        if (actions === undefined) return
        if (draft.trim() === '') {
          setEntry(sessionId, { status: 'notice', visible: true, notice: t('noticeEmpty') })
          return
        }
        if (phase !== 'plain') {
          setEntry(sessionId, { status: 'notice', visible: true, notice: t('noticeBusy') })
          return
        }
        var sentText = draft
        setEntry(sessionId, {
          status: 'running',
          visible: true,
          error: '',
          notice: '',
          pendingApply: false,
          original: sentText,
          sentText: sentText,
          optimized: '',
          changes: [],
          before: null,
          after: null
        })
        postJson(ROUTES.optimize, {
          text: sentText,
          sessionId: sessionId === undefined ? undefined : sessionId,
          goals: ALL_GOALS,
          locale: pageLocale()
        }).then(function (payload) {
          var optimized = typeof payload.optimized === 'string' ? payload.optimized : ''
          var live = store.drafts.get(sessionId)
          var untouched = typeof live !== 'string' || live === sentText
          setEntry(sessionId, {
            status: 'done',
            visible: true,
            optimized: optimized,
            before: payload.before === undefined ? null : payload.before,
            after: payload.after === undefined ? null : payload.after,
            changes: Array.isArray(payload.changes) ? payload.changes : [],
            provider: typeof payload.provider === 'string' ? payload.provider : '',
            model: typeof payload.model === 'string' ? payload.model : '',
            goals: Array.isArray(payload.goals) ? payload.goals : ALL_GOALS,
            pendingApply: !untouched
          })
          if (untouched && optimized !== '') {
            actions.setDraft(optimized)
            actions.persistDraft()
          }
        }).catch(function (error) {
          setEntry(sessionId, {
            status: 'error',
            visible: true,
            error: error !== null && error !== undefined && typeof error.message === 'string' ? error.message : String(error)
          })
        })
      }, [actions, draft, phase, running, sessionId, t])

      return h('button', {
        type: 'button',
        className: running ? 'po-btn tint' : 'po-btn',
        title: t('buttonHint'),
        'aria-label': t('buttonHint'),
        'aria-busy': running ? 'true' : 'false',
        disabled: running,
        onClick: onClick
      },
        running ? h('span', { className: 'po-spin', 'aria-hidden': 'true' }) : null,
        h('span', null, running ? t('running') : t('button'))
      )
    }

    function ResultPanel(props) {
      var sessionId = props.sessionId
      var t = useLabels(props.ctx)
      var entry = useEntry(sessionId)
      var actions = props.inputActions

      if (entry.visible !== true) return null
      if (entry.status === 'running') return null

      var hide = function () { setEntry(sessionId, { visible: false }) }

      if (entry.status === 'notice') {
        return h('div', { className: 'po-root' },
          h('div', { className: 'po-panel', role: 'status', 'aria-live': 'polite' },
            h('div', { className: 'po-head' },
              h('span', { className: 'po-note' }, entry.notice),
              h('span', { className: 'po-spacer' }),
              h('button', { type: 'button', className: 'po-btn ghost', onClick: hide }, t('hide'))
            )
          )
        )
      }

      if (entry.status === 'error') {
        return h('div', { className: 'po-root' },
          h('div', { className: 'po-panel', role: 'status', 'aria-live': 'polite' },
            h('div', { className: 'po-head' },
              h('span', { className: 'po-title' }, t('title')),
              h('span', { className: 'po-spacer' }),
              h('button', { type: 'button', className: 'po-btn ghost', onClick: hide }, t('hide'))
            ),
            h('div', { className: 'po-error' }, t('failed') + ': ' + entry.error)
          )
        )
      }

      var before = entry.before
      var after = entry.after
      var beforeTotal = before === null || before === undefined ? 0 : before.total
      var afterTotal = after === null || after === undefined ? 0 : after.total
      var delta = afterTotal - beforeTotal
      var regressed = DIMENSIONS.filter(function (id) { return detailOf(after, id) < detailOf(before, id) }).length
      var beforeChars = before === null || before === undefined ? 0 : before.chars
      var afterChars = after === null || after === undefined ? 0 : after.chars
      var beforeTokens = before === null || before === undefined ? 0 : before.estTokens
      var afterTokens = after === null || after === undefined ? 0 : after.estTokens

      var actionsRow
      if (entry.pendingApply === true) {
        actionsRow = h('div', { className: 'po-actions' },
          h('button', {
            type: 'button', className: 'po-btn tint',
            onClick: function () {
              if (actions === undefined) return
              actions.setDraft(entry.optimized)
              actions.persistDraft()
              setEntry(sessionId, { pendingApply: false })
            }
          }, t('applyNow')),
          h('button', {
            type: 'button', className: 'po-btn',
            onClick: function () { setEntry(sessionId, { pendingApply: false, visible: false }) }
          }, t('keepMine'))
        )
      } else {
        actionsRow = h('div', { className: 'po-actions' },
          h('button', {
            type: 'button', className: 'po-btn',
            onClick: function () {
              if (actions === undefined) return
              actions.setDraft(entry.original)
              actions.persistDraft()
              setEntry(sessionId, { visible: false })
            }
          }, t('undo'))
        )
      }

      return h('div', { className: 'po-root', role: 'status', 'aria-live': 'polite' },
        h('div', { className: 'po-panel' },
          h('div', { className: 'po-head' },
            h('span', { className: 'po-title' }, t('title')),
            h('span', { className: 'po-spacer' }),
            entry.model === '' ? null : h('span', { className: 'po-note' }, entry.model),
            h('button', { type: 'button', className: 'po-btn ghost', onClick: hide }, t('hide'))
          ),
          h('div', { className: 'po-score' },
            h('span', { className: 'po-num muted' }, String(beforeTotal)),
            h('span', { className: 'po-arrow' }, '→'),
            h('span', { className: 'po-num' }, String(afterTotal)),
            h('span', { className: chipClass(delta) }, chipText(delta)),
            regressed > 0 ? h('span', { className: 'po-warn', style: { fontSize: '11px' } }, t('regressed', { n: regressed })) : null,
            h('span', { className: 'po-spacer' }),
            h('span', { className: 'po-note' },
              String(beforeChars) + ' ' + t('chars') + ' → ' + String(afterChars) + ' ' + t('chars') + ' · ' +
              t('tokens') + ' ' + String(beforeTokens) + ' → ' + String(afterTokens)
            )
          ),
          h('div', { className: 'po-caveat' }, t('caveat')),
          h(Dimensions, { before: before, after: after, t: t }),
          entry.changes.length === 0 ? null : h('div', null,
            h('div', { className: 'po-note', style: { marginTop: '10px' } }, t('changes')),
            h('ul', { className: 'po-changes' }, entry.changes.map(function (item, index) {
              return h('li', { key: String(index) }, item)
            }))
          ),
          entry.pendingApply === true ? h('div', { className: 'po-note', style: { marginTop: '8px' } }, t('pendingHint')) : null,
          actionsRow
        )
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        var disposers = []
        var disposeEffect = function () {}
        try {
          ensureCss()
          disposeEffect = ctx.effect(function () {
            return ctx.locale.register(NS, { zh: LABELS.zh, en: LABELS.en })
          }, NS + ': copy')
        } catch (error) {
          // Styling and copy both degrade to inline fallbacks.
          console.error('[' + NS + '] setup failed:', error)
        }
        try {
          disposers.push(ctx.slots.inject('conversation.input.right', function () {
            return ctx.slots.register({ name: 'conversation.input.right', id: NS, order: 6 }, function (props) {
              return h(OptimizeButton, Object.assign({}, props, { ctx: ctx }))
            })
          }))
        } catch (error) {
          console.error('[' + NS + '] composer button failed to register:', error)
        }
        try {
          disposers.push(ctx.slots.inject('conversation.composer.dock', function () {
            return ctx.slots.register({ name: 'conversation.composer.dock', id: NS + '-panel', order: 6 }, function (props) {
              return h(ResultPanel, Object.assign({}, props, { ctx: ctx }))
            })
          }))
        } catch (error) {
          console.error('[' + NS + '] comparison panel failed to register:', error)
        }
        ctx.effect(function () {
          return function () {
            if (typeof disposeEffect === 'function') disposeEffect()
            for (var i = 0; i < disposers.length; i += 1) {
              if (typeof disposers[i] === 'function') disposers[i]()
            }
          }
        }, NS + ': slots')
      }
    }
  }
})
