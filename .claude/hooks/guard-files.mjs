// PreToolUse (Edit|Write|MultiEdit|NotebookEdit): protect secrets and applied migrations.
// Exit code 2 blocks the tool call and shows stderr to Claude.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';

const input = JSON.parse(
  await new Promise((r) => {
    let d = '';
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => r(d || '{}'));
  }),
);

const filePath = String(input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '');
const normalized = filePath.replaceAll('\\', '/');
const name = basename(normalized);

function block(reason) {
  process.stderr.write(`Blocked by .claude/hooks/guard-files.mjs: ${reason}\n`);
  process.exit(2);
}

if (/^\.env(\..+)?$/.test(name) && name !== '.env.example') {
  block(`${name} holds secrets. Ask the human to edit it; update .env.example instead.`);
}

if (normalized.includes('/packages/db/migrations/') && existsSync(filePath)) {
  block(
    'Applied migrations are immutable. Change packages/db/src/schema and run `pnpm db:generate` to create a new migration.',
  );
}

process.exit(0);
