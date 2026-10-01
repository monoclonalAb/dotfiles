// Source-only check against installed Pi; no dependencies installed or repository output.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const pkg = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const root = mkdtempSync(join(tmpdir(), 'agent-stuff-types-'));
try {
  const paths = Object.fromEntries(['pi-ai', 'pi-tui'].map(name => [`@earendil-works/${name}`, [join(pkg, `node_modules/@earendil-works/${name}/dist/index.d.ts`)]]));
  paths['@earendil-works/pi-coding-agent'] = [join(pkg, 'dist/index.d.ts')];
  paths.typebox = [join(pkg, 'node_modules/typebox/build/index.d.mts')];
  const config = join(root, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({ compilerOptions: {
    noEmit: true, skipLibCheck: true, strict: true, target: 'ES2023', module: 'Preserve',
    moduleResolution: 'Bundler', allowImportingTsExtensions: true, types: ['node'],
    typeRoots: [join(pkg, 'node_modules/@types')], paths,
  }, files: [fileURLToPath(new URL('index.ts', import.meta.url))] }));
  execFileSync('tsc', ['-p', config], { stdio: 'inherit' });
  console.log('PASS: all five extensions against installed Pi public types.');
} finally { rmSync(root, { recursive: true, force: true }); }
