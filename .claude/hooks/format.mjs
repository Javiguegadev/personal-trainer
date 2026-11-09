// PostToolUse (Edit|Write|MultiEdit): format the edited file with Prettier. Never blocks.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const input = JSON.parse(
  await new Promise((r) => {
    let d = '';
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => r(d || '{}'));
  }),
);

const filePath = String(input.tool_input?.file_path ?? '');
const formattable = /\.(ts|tsx|js|mjs|cjs|jsx|json|css|md|ya?ml)$/i;

if (filePath && formattable.test(filePath) && existsSync(filePath)) {
  spawnSync('pnpm', ['exec', 'prettier', '--write', '--log-level', 'silent', filePath], {
    cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    shell: process.platform === 'win32',
    stdio: 'ignore',
  });
}

process.exit(0);
