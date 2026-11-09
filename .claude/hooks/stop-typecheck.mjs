// Stop: if TypeScript files changed, don't let Claude finish with type errors.
// Exit code 2 sends stderr back to Claude so it keeps working on the errors.
import { spawnSync } from 'node:child_process';

const input = JSON.parse(
  await new Promise((r) => {
    let d = '';
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => r(d || '{}'));
  }),
);

// Avoid infinite loops: if we already blocked once this turn, let Claude stop.
if (input.stop_hook_active) process.exit(0);

const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const isWin = process.platform === 'win32';

const status = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
const changedTs = (status.stdout ?? '').split('\n').some((l) => /\.(ts|tsx)$/.test(l.trim()));
if (!changedTs) process.exit(0);

const tc = spawnSync('pnpm', ['turbo', 'typecheck', '--output-logs=errors-only'], {
  cwd,
  encoding: 'utf8',
  shell: isWin,
});

if (tc.status !== 0) {
  const out = `${tc.stdout ?? ''}\n${tc.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
  process.stderr.write(`Typecheck failed. Fix these before finishing:\n${out}\n`);
  process.exit(2);
}

process.exit(0);
