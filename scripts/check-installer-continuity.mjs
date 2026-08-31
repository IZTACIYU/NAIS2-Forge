import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hook = readFileSync('src-tauri/nsis/installer-hooks.nsh', 'utf8')

assert.match(hook, /ReadRegStr \$R0 SHCTX "Software\\sunakgo\\NAIS2-Forge" ""/)
assert.match(hook, /\$\{FileExists\} "\$R0\\\$\{MAINBINARYNAME\}\.exe"/)
assert.match(hook, /StrCpy \$INSTDIR \$R0/)
assert.match(hook, /StrCpy \$INSTDIR \$R0\s+SetOutPath \$INSTDIR/)

console.log('Installer continuity checks passed.')
