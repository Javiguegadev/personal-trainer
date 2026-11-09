// PreToolUse (Bash|PowerShell): block commands that touch remote databases or rewrite history.
// These stay human-only. Exit code 2 blocks the call and shows stderr to Claude.
const input = JSON.parse(
  await new Promise((r) => {
    let d = '';
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => r(d || '{}'));
  }),
);

const cmd = String(input.tool_input?.command ?? '');

const rules = [
  [/supabase\s+db\s+push/, 'Pushing migrations to a remote Supabase project is a human step.'],
  [/supabase\s+db\s+reset\s+.*--linked/, 'Resetting a linked (remote) database is a human step.'],
  [
    /drizzle-kit\s+push/,
    'Use `pnpm db:generate` + review + `pnpm db:migrate` (local) instead of drizzle-kit push.',
  ],
  [/git\s+push\s+.*(--force\b|-f\b|--force-with-lease)/, 'Force-push is a human step.'],
  [/(vercel|fly)\s+.*--prod\b/, 'Production deploys are a human step.'],
];

for (const [re, reason] of rules) {
  if (re.test(cmd)) {
    process.stderr.write(`Blocked by .claude/hooks/guard-bash.mjs: ${reason}\n`);
    process.exit(2);
  }
}

process.exit(0);
