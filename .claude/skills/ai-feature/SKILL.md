---
name: ai-feature
description: Build or change a Claude-powered premium feature (meal plans, swaps, workout programs, adaptation, NL food logging) with structured outputs, core validation, evals and cost metering. Use for anything touching packages/ai or AI endpoints.
---

# AI feature

Read the `claude-api` skill before writing SDK code. Never guess SDK signatures or model IDs.

## Design rules

- Server-side only (`apps/api` → `@pt/ai`). Model and effort are configured per feature in one place
  (`packages/ai/src/config.ts`). Changing them requires an eval run.
- **Structured outputs**: the output schema is a Zod schema in `@pt/contracts`, parsed by the SDK. No
  free-text parsing.
- **The AI chooses, core computes**: the model returns catalog IDs (foods, exercises) plus quantities.
  `@pt/core` computes macros and volume and validates targets (±5% kcal), allergens (zero tolerance),
  calorie floor, and week-over-week volume increases (≤ 10%). On a validation failure, retry once with
  the errors fed back, then fail gracefully.
- Check `stop_reason` (`refusal`, `max_tokens`) before using any output.
- Put the stable system prompt first and cache it. User-specific context goes after the cache
  breakpoint.
- Log every call to `ai_generations` (feature, model, input/output tokens, cost, status, latency) and
  enforce fair-use caps per plan.
- Bulk recomputations (weekly adaptation) use the Message Batches API through a background job.

## Steps

1. Spec the feature (`feature-spec`), including the safety cases.
2. Add the output schema to contracts and the validators to core (test-first).
3. Write the prompt in `packages/ai/src/prompts/<feature>/` and add ≥ 15 eval fixtures in
   `packages/ai/evals/<feature>/` (normal users, allergies, vegan, minors, extreme goals).
4. Implement and run the evals. **Running evals spends API money, so ask the human first.**
5. Report the pass rate and the average cost per call. The gate is ≥ 95% valid outputs and 0 allergen
   violations.
