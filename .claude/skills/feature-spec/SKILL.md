---
name: feature-spec
description: Turn a feature idea into a reviewed spec file in docs/specs/ before any code is written. Use when the user describes a new feature, screen, endpoint or AI capability, or says "spec", "especifica", "nueva funcionalidad".
---

# Feature spec

Goal: a spec the human can approve in 5 minutes and Claude can implement without guessing.

1. Read `CLAUDE.md`, `docs/BLUEPRINT.md` (the relevant phase) and existing specs in `docs/specs/`
   to avoid overlap.
2. Ask at most 3 questions, and only about product decisions you cannot infer (limits, free vs premium,
   copy tone). Otherwise state the assumption in the spec.
3. Copy `docs/specs/_template.md` to `docs/specs/NNN-kebab-name.md` (next free number) and fill every
   section. Rules:
   - Acceptance criteria are testable statements (Given/When/Then), numbered `AC1..ACn`.
   - Data changes list tables/columns with types, plus the RLS rule in one line.
   - API contracts name the Zod schemas to add to `@pt/contracts` and each route's method/path/status codes.
   - Mark which ACs are free and which are premium.
   - Include health/safety edge cases for nutrition and training features (minimum calories, minors, injuries).
   - "Out of scope" is mandatory.
4. Stop and ask the human to review. Do not start implementing in the same turn.
