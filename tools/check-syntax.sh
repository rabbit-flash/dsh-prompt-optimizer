#!/usr/bin/env bash
set -e
NODE="C:\Users\langb\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe"
cd "C:\Users\langb\Documents\deepseek-harness\default-workspace\dsh-prompt-optimizer"
for f in index.js lib/score.js lib/prompt.js; do "$NODE" --check "$f"; echo "ok $f"; done
echo SYNTAX_OK
