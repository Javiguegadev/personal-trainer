# Personal Trainer

AI-powered nutrition & fitness app (freemium). Web first, mobile-ready monorepo.

- Architecture & roadmap: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md)
- Working with Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Quick start

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev        # web http://localhost:3000 · api http://localhost:8787/health
pnpm check      # typecheck + lint + test
```

Node ≥ 22, pnpm 12.
