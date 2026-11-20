#!/usr/bin/env bash
# Full offline verification: syntax, host routes, client slots, effect gate.
set -u
cd "$(dirname "$0")/.." || exit 1
NODE="C:/Users/langb/.dsh/dsh-runtimes/dsh-next-primary-runtime/dependencies/node/bin/node.exe"
status=0
for f in index.js client.js lib/score.js lib/prompt.js; do
  if "$NODE" --check "$f" >/tmp/po-check.log 2>&1; then echo "syntax ok  $f"; else echo "syntax BAD $f"; cat /tmp/po-check.log; status=1; fi
done
echo "--- host routes ---"
"$NODE" tests/host.test.mjs || status=1
echo "--- client slots ---"
"$NODE" tests/client.test.mjs || status=1
echo "--- effect gate ---"
"$NODE" tests/verify.mjs || status=1
echo "--- manifest ---"
"$NODE" -e "const m=require('./package.json');const fs=require('fs');const need=['index.js','client.js','cordis.patch.yml','locale/en.json','locale/zh.json','icon.svg','docs/DETAIL.md'];const miss=need.filter(p=>!fs.existsSync(p));if(miss.length){console.log('MISSING '+miss.join(','));process.exit(1)};if(!m.dsh||!m.dsh.bundle||!m.dsh.client){console.log('BAD dsh manifest');process.exit(1)};for(const k of ['.','./client','./locale/*.json','./icon'])if(!m.exports[k]){console.log('BAD exports '+k);process.exit(1)};console.log('manifest ok: '+m.name+' '+m.version)" || status=1
echo "--- publish preflight ---"
"$NODE" tools/preflight.mjs || status=1
echo "--- market index format ---"
"$NODE" tools/build-index.mjs --self-test || status=1
echo ""
if [ "$status" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "CHECKS FAILED"; fi
exit $status
