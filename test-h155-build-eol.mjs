// H155: actual Git checkouts under both autocrlf modes must build the same bytes.
// All Git writes and generated artifacts stay in an isolated temporary repository.
import {cpSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, symlinkSync, realpathSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const directory = mkdtempSync(join(tmpdir(), 'balam-h155-eol-'));
const seed = join(directory, 'seed'); mkdirSync(seed);
cpSync('balam', join(seed, 'balam'), {recursive: true});
for (const file of ['.gitattributes', 'build-offline.mjs', 'POS Balam.html', 'POS Balam (offline).html', 'POS Balam (offline).BACKUP.html']) {
  if (existsSync(file)) cpSync(file, join(seed, file));
}
const git = args => execFileSync('git', ['-C', seed, ...args], {encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
git(['init', '--quiet']);
git(['-c', 'core.autocrlf=false', 'add', '.']);
const inputs = git(['ls-files', '-z']).split('\0').filter(Boolean);
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const checkouts = ['false', 'true'].map(mode => {
  const target = join(directory, 'autocrlf-' + mode); mkdirSync(target);
  git(['-c', 'core.autocrlf=' + mode, 'checkout-index', '--all', '--prefix=' + target.replace(/\\/g, '/') + '/']);
  return target;
});
const differences = inputs.filter(file => sha(join(checkouts[0], file)) !== sha(join(checkouts[1], file)));
assert.equal(differences.length, 0, 'autocrlf changes build inputs: ' + differences.slice(0, 8).join(', '));
console.log('PASS actual Git checkouts preserve all ' + inputs.length + ' build inputs under autocrlf=false/true');
if (!process.argv.includes('--checkout-only')) {
  const hashes = [];
  for (const target of checkouts) {
    symlinkSync(realpathSync('node_modules'), join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const log = execFileSync(process.execPath, ['build-offline.mjs'], {
      cwd: target, encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 10000000,
    });
    writeFileSync(join(target, 'build.log'), log);
    hashes.push(Object.fromEntries(['index.html', 'POS Balam (offline).html', 'sw.js'].map(file => [file, sha(join(target, file))])));
  }
  assert.deepEqual(hashes[0], hashes[1], 'checkouts generated different delivery artifacts');
  console.log('PASS two real builds have identical delivery bytes', JSON.stringify(hashes[0]));
}
console.log('H155 checkout/build evidence: ' + directory);
