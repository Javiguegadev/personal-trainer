# ADR 003: User context as a read model, activity split, adaptive loop, beta before payments

- Status: accepted
- Date: 2026-11-12
- Supersedes: parts of ADR 002 (stage order, MVP definition) and the blueprint v2 data model

## Context

A review of blueprint v2 against the product vision (profile, nutrition, and training that combines the
gym with a sport such as football) found that the monorepo structure and its dependency rules hold. Three
things do not:

1. **The domain model only supports calorie counting.** One `goal` enum cannot express "lose fat and
   perform in football". A single `activity_level` mixes job activity with exercise, so exercise is
   counted twice once training is logged. Weight is one value, so there is no trend to adapt to. Work
   schedule, sleep, stress and sport commitments have no place at all.
2. **Nothing closes the loop.** Targets are computed once, at onboarding. Predictive equations and
   activity factors carry a sizeable individual error, and nothing corrects it afterwards.
3. **The stage order delays value.** Payments (E6) came before the features worth paying for (E7), the
   knowledge base (E3) imported five sources before any user-visible feature, and diets and routines, the
   core of the product, were outside the MVP.

The human also added a requirement: a "living context" (work schedule, job type, stress, sleep, training
and meal history) that nutrition and training both use.

## Decision

Taken with the human on 2026-11-12:

1. **Beta before payments.** The order becomes E2 → E2b → E4 → E5 → E5b → beta (no paywall) → E7 → E6 →
   E8 → E9. `canUse()` and per-user daily AI caps exist from the beta with a single plan. RevenueCat and
   Paddle are integrated once there is something to sell. Paperwork with lead times (store accounts,
   Paddle verification, source licenses, the professional reviewer) starts now.
2. **Hybrid onboarding.** One conversational flow: taps (chips, pickers) collect the categorical and
   numeric fields, and free text collects nuance (routine, tastes, injuries). The standalone form stays
   only as the fallback when the AI is unavailable or rate limited. It is built in E2b together with
   decision 4, so onboarding is reworked once. Spec 001 closes as written.
3. **Weekly review in the MVP.** Weight trend, adherence, sleep and stress produce a proposed target
   adjustment that the user accepts or rejects. It is deterministic and lives in `@pt/core`.
4. **Split `activity_level`.** Job (daily-life) activity and planned training become separate inputs.
   `targets-v2` adds the energy of the planned training to a daily-life factor. It is done in E2b, before
   any real user exists.
5. **Optional daily check-in in the MVP.** Sleep and stress in two taps. A deterministic day readiness
   adjusts today's session and shows the reason. Skipping the check-in never breaks a streak, and a
   missing answer means "unknown".
6. **AI-learned memory after the beta.** It arrives in E7 through a tool, as a proposal the user confirms,
   and is always visible and editable in "What I know about you". Until then the context holds only
   declared and derived data.

Supporting design (details are settled in each stage's spec):

7. **The user context is a read model, not a store.** Typed tables per kind of data (declared, daily
   signals, logs, learned) → pure functions in `@pt/core` → a versioned `ContextSnapshot` in
   `@pt/contracts`. `core` and the AI features consume it, and each AI feature receives only the slice it
   needs. No JSONB context blob and no per-user vector memory.
8. **Hard and soft constraints.** Allergies, injuries, work hours and match days are validators in `core`
   that reject an AI output. Sleep, stress and tastes are prompt input and bounded deterministic rules.
   The AI never derives numbers from them.
9. **Two goal axes.** `profiles.goal` (weight direction) and `training_profiles.focus` (hypertrophy,
   strength, sport performance, general fitness).
10. **Templates and instances share a shape.** Plan items have the shape of log items, so a planned meal
    or session is logged in one tap. `meals` → `meal_items` replaces the flat `meal_entries`.
11. **Offline-safe writes.** Client-generated ids, idempotent `PUT /resource/:id`, `local_date` with a
    configurable day start, and a persisted mutation queue in the app.
12. **Knowledge base by slice.** Each source ships with the stage that needs it, and the Spanish food
    search gets its own eval first. E3 is no longer a standalone stage.
13. **Photo accuracy is measured separately** from text and barcode input. A photo always produces an
    editable draft, never an automatic entry.

## Consequences

- `profiles.activity_level` and `profiles.weight_kg` are replaced (lifestyle + routine, and
  `body_measurements`). There are no production users, so it is a schema change without data migration,
  but the onboarding prompt, its tool schema, its evals and both fake backends change with it.
- Sleep, stress and work schedule are new data categories, and AI-learned memory stores facts taken from
  conversations. The consent text and `CONSENT_VERSION` must change and consent is asked again. Export and
  deletion must cover every new table, so their tests should derive the table list from the schema.
- `core` gains more rules that need professional review before the beta: daily-life activity factors, MET
  values, readiness thresholds, weekly-review rules and sport + gym scheduling rules.
- The beta produces no revenue, and daily caps are the only bound on its AI cost.
- Stage IDs keep their meaning but no longer imply order: E7 runs before E6.
- A daily check-in can tire users. It is shown only when the answer can change that day's recommendation,
  and it is prefilled with the usual values.
- HealthKit / Health Connect import stays in E10. It needs native modules and a development build and has
  no web equivalent, so the manual check-in must be enough on its own.
