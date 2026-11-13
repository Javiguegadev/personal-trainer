# ADR 005: The latest logged weight is copied to the profile and recomputes the targets

- Status: accepted
- Date: 2026-11-13
- Amends: BLUEPRINT §5 (data model), from spec 003

## Context

BLUEPRINT §5 makes weight a time series (`body_measurements`) and lists no weight on `profiles`. The
targets (`targets-v2`) and the safety rules of specs 001 and 002 read one weight, `profiles.weight_kg`,
through `evaluateProfileInput`. While writing spec 003 the human first chose that a logged weight would not
change the calories, then decided (2026-11-13) that it should: a new weight recomputes the targets, with a
notice showing the old and the new calories, and a weight in the low-BMI range removes the deficit through
the existing rule.

## Decision

1. **`body_measurements` is the weight history**: one row per user and day (`user_id`, `local_date`,
   `weight_kg`, `recorded_at`), the later `recorded_at` wins when two devices write the same day.
2. **`profiles.weight_kg` stays, as a copy of the most recent entry by day.** The API updates it in the
   same transaction as the entry and evaluates the stored profile again with it (`applyLatestWeight` in
   `@pt/core`, which reuses the rules of `evaluateProfileInput`). A new `nutrition_targets` row is stored
   only when the numbers change.
3. **An entry for an earlier day, or deleting one, changes nothing**; deleting the most recent entry
   recomputes with the one before it. Saving the profile form with another weight stores it as today's
   entry.

## Consequences

- The targets, the safety rules and the user context keep a single weight input; no rule is duplicated.
- Normal daily swings move the calories by about 10–20 kcal (1 kg ≈ 15–25 kcal). The fast-loss notice
  uses 7-day averages, never one reading. A mistyped weight is caught by a confirmation above 3 % and is
  undone by correcting or deleting the entry.
- The weekly review (E5b) may later adjust the targets from the trend and the adherence; it will read the
  same table.
