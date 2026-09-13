// Reproducible inventory of executable UI declaration sites, using the locked
// Sucrase tokenizer. A source connection is not proof of persistence or success.
const fs = require('fs'), crypto = require('crypto');
const { parse } = require('sucrase/dist/parser/index.js');
const files = fs.readdirSync('balam').filter(name => name.endsWith('.jsx')).sort();
const rows = [], sources = {};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const literal = value => value.replace(/^['"]|['"]$/g, '');
for (const name of files) {
  const file = 'balam/' + name, source = fs.readFileSync(file, 'utf8');
  sources[file] = sha(source);
  const tokens = parse(source, true, false, false).tokens;
  const text = index => source.slice(tokens[index]?.start, tokens[index]?.end);
  const match = index => {
    const contextId = tokens[index].contextId;
    if (contextId == null) throw Error('Missing call context in ' + file);
    for (let j = index + 1; j < tokens.length; j++) {
      if (tokens[j].contextId === contextId && text(j) === ')') return j;
    }
    throw Error('Unclosed declaration in ' + file + ':' + tokens[index].start);
  };
  for (let i = 0; i < tokens.length - 3; i++) {
    if (text(i + 1) !== '(') continue;
    const callee = text(i), tag = literal(text(i + 2));
    const isElement = callee === 'h' && (/^(button|input|select|textarea|a|summary|dialog|details)$/.test(tag)
      || /Modal|Badge|Alert|Banner|Warning|Toggle|Menu|Segment|Cfg|Field|Picker|Notice|Status/.test(tag));
    const isMessage = /^(toast|alert|confirm|showError|setError)$/.test(callee);
    if (!isElement && !isMessage) continue;
    if (tokens[i + 1].contextId == null) continue; // Function declaration, not a call.
    const end = match(i + 1), snippet = source.slice(tokens[i].start, tokens[end].end);
    const line = source.slice(0, tokens[i].start).split('\n').length;
    const handlers = [...snippet.matchAll(/\b(on[A-Z]\w*)\s*(?::|,|})/g)].map(m => m[1]);
    const configKey = snippet.match(/\bk:\s*['"]([^'"]+)['"]/i)?.[1];
    rows.push({ id: file + ':' + line + ':' + tokens[i].start + ':' + (isElement ? tag : callee), file, line, sourceOffset: tokens[i].start,
      declaration: isElement ? tag : callee, kind: isMessage ? 'message' : 'control-or-state',
      classification: 'KEEP', classificationScope: 'Existing productive declaration; runtime result requires the linked workflow evidence',
      configKey, triggers: [...new Set(handlers)],
      backend: /\b(STORE|DATA|AUTH|CONFIG|D|C)\./.test(snippet) ? 'Domain/authority call in declaration; inspect source and surface matrix' : 'Callback, navigation or presentation; inspect source and surface matrix',
      persistence: 'NOT_PROVEN_BY_STATIC_INVENTORY', result: 'NOT_PROVEN_BY_STATIC_INVENTORY',
      declarationSha256: sha(snippet), sourceExcerpt: snippet.slice(0, 1200), excerptTruncated: snippet.length > 1200 });
  }
}
for (const key of ['currency','pos.askSize','pos.allowLayaway','commission.auto','pos.sound','print.lowStockAlert']) {
  rows.push({ id: 'removed-setting:' + key, configKey: key, classification: 'REMOVE',
    result: 'Removed editor; historical value preserved', evidence: 'h171-controls.md; h171-controls-before.json; h171-controls-after.json' });
}
rows.push({ id: 'removed-action:birthday-message', classification: 'REMOVE',
  result: 'Button had no handler or link; birthday information remains', evidence: 'h171-surfaces.md; h171-users-responsive' });
const report = { generatedAt: new Date().toISOString(), sources,
  scope: 'All matched executable h() control/state declaration sites and direct toast/alert/confirm/error-state calls in balam/*.jsx. Repeated runtime items share their declaration. Composite custom controls and native browser dialogs require the surface matrix; this is not exhaustive runtime certification.',
  authority: 'BALAM ADR-015; telohdbvbvsfmwyriflz; pos',
  limitations: ['KEEP is a retention decision, not a test result.', 'Handler lists can include child declarations; inspect the exact source location.', 'Dynamic banner/status text is covered by its declaring component, not by enumerating every possible message.', 'No external request or business mutation is performed.'],
  summary: { declarations: rows.filter(r => r.file).length, removedControls: 7,
    files: Object.keys(sources).length, persistenceCertifiedByThisInstrument: 0 }, rows };
fs.writeFileSync('docs/fixes/evidence/h171/control-inventory.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
