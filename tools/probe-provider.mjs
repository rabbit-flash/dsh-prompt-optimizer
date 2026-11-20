const base = 'http://127.0.0.1:18900/v1'
const out = { models: null, error: null }
try {
  const response = await fetch(base + '/models', { method: 'GET', signal: AbortSignal.timeout(4000) })
  out.status = response.status
  const text = await response.text()
  out.models = text.slice(0, 400)
} catch (error) { out.error = String(error && error.message || error) }
console.log(JSON.stringify(out))
