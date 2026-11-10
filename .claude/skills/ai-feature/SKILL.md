---
name: ai-feature
description: Build or change a Claude-powered feature (conversational onboarding, food/workout logging from text or photos, swaps, meal plans, workout programs, adaptation, coach chat, insights) with grounded tools, structured outputs, core validation, evals and cost metering. Use for anything touching packages/ai or AI endpoints.
---

# AI feature

Read the `claude-api` skill before writing SDK code. Never guess SDK signatures or model IDs.

## Design rules

- Server-side only (`apps/api` → `@pt/ai`). Model and effort are configured per feature in one place
  (`packages/ai/src/config.ts`): **Claude Haiku 5.5** for high-volume/fast tasks (logging, swaps,
  onboarding, daily feedback, label/plate photos), **Claude Opus 5.5** for meal plans, programs,
  adaptation and coach chat. Changing a feature's model or effort requires an eval run.
- **Grounded, not memorized**: the model gets data through tools backed by the knowledge base
  (`search_foods`, `get_food`, `search_exercises`, `get_guideline`, `get_user_stats`). Prompts tell it to
  use only tool results for facts and numbers, and to cite sources (`source_id`, guideline citation).
- **Structured outputs**: the output schema is a Zod schema in `@pt/contracts`, parsed by the SDK. No
  free-text parsing. Tool inputs use `strict: true`.
- **The AI chooses, core computes**: the model returns catalog IDs plus quantities. `@pt/core` computes
  macros and volume and validates targets (±5% kcal), allergens (zero tolerance), the calorie floor, and
  week-over-week volume increases (≤ 10%). On a validation failure, retry once with the errors fed back,
  then fail gracefully with a manual fallback in the UI.
- Photos (plates, labels): resize on the device before upload, send as an image block, and never store
  them longer than the feature needs.
- Check `stop_reason` (`refusal`, `max_tokens`) before using any output.
- Put the stable system prompt and tool definitions first and cache them. User-specific context goes
  after the cache breakpoint.
- Minimize personal data in prompts: no names, emails or exact birth dates (send age).
- Log every call to `ai_usage` (feature, model, tokens, cost, latency, status) and enforce per-plan caps.
- Bulk work (weekly insights, adaptation) uses the Message Batches API from a queued job.

## Steps

1. Spec the feature (`feature-spec`), including the safety cases and the manual fallback.
2. Add the output/tool schemas to contracts and the validators to core (test-first).
3. If the feature needs data the knowledge base doesn't have yet, use the `knowledge-import` skill first.
4. Write the prompt in `packages/ai/src/prompts/<feature>/` and add ≥ 15 eval fixtures in
   `packages/ai/evals/<feature>/` (normal users, allergies, vegan, minors, extreme goals, Spanish dishes,
   ambiguous inputs like "un plato de lentejas").
5. Implement and run the evals. **Running evals spends API money, so ask the human first.**
6. Report the pass rate, the citation rate and the average cost per call. The gate is ≥ 95% valid
   outputs, 0 allergen violations, and the cost target in BLUEPRINT §3.
