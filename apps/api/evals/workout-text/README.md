# Workout sentence eval (spec 012 AC18, AC19)

Sentences about a workout already done, as people type or dictate them, with the draft a right
reading gives. It is the exit criterion of stage E5: at least 95 % of the sentences parse correctly.
Run it with `pnpm --filter @pt/api eval:workout-text`. It calls the real model and reads the exercise
catalog of the dev database, so it spends API money (about 0.001 USD per sentence): ask before
running it. Run it before the feature ships and on every change of the prompt, the model or its
settings, or the exercise catalog.

The cases (`cases.jsonl`) were written by an agent that saw only the exercise catalog
(`packages/db/src/knowledge/catalog/exercises.csv`), not the prompt. Review a sample by hand before
trusting the numbers. `pnpm --filter @pt/api eval:workout-text:check` checks the cases against the
catalog of the dev database (keys, ids, values the tracking of an exercise drops) without calling the
model.

The runner uses the API's own code (`createWorkoutDrafter`: refs, the reader, `workoutDraft`) for a
user with no exercises of their own, on a fixed day: today and the screen's day are **Wednesday
2026-11-25**, so "el lunes" is 2 days ago.

## Format of `cases.jsonl`

```json
{"id":"es-001","locale":"es","kind":"notation_basic","text":"press banca 4x8 con 60 y remo con barra 3x10 con 50","expect":{"status":"ok","exercises":[{"keys":["press-banca"],"sets":[{"n":4,"reps":8,"kg":60}]},{"keys":["remo-barra"],"sets":[{"n":3,"reps":10,"kg":50}]}]}}
{"id":"es-050","locale":"es","kind":"activity_minutes","text":"ayer pádel hora y media, un 8 de esfuerzo","expect":{"status":"ok","daysAgo":1,"activity":{"type":"padel","minutes":90,"rpe":8}}}
{"id":"es-120","locale":"es","kind":"not_workout","text":"¿qué entreno hoy?","expect":{"status":"not_workout"}}
```

- `expect.status`: `ok`, `not_workout` or `unclear`. For `ok`, an omitted field is null, false or
  empty: `exercises`, `minutes` and `rpe` of the gym session, `daysAgo` (the day said; more than 6 is
  dropped and the draft keeps the screen's day), `startTime` (`HH:MM`), `pain`, `activity` (the draft
  when there is no gym session) and `extras` (the "También" lines).
- `exercises[].keys`: catalog keys that count as a right match, the reference first, all with the
  same tracking; `[]` for an exercise the catalog lacks (the draft should leave it unresolved).
- `exercises[].sets`: groups `{n, reps, kg, s, m}` (`n` sets alike; an omitted value is null), after
  the tracking filter of `@pt/core` (a `duration` exercise keeps only `s`). Pounds are given in kg.
- `activity` and `extras[]`: `{type, minutes, rpe, distance}` (`distance`: a distance or a pace was
  said).

## Gate

- At least 95 % of the sentences parse correctly: the expected exercises in order (each matched to
  one of its keys, or unresolved when `keys` is empty) and nothing else, every set with the expected
  values (reps and seconds exact, weight within 0.1 kg, distance within 1 m, null when not said), and
  the duration, RPE, day, start time, activity, extra activities and pain flag as expected.
- No sentence without a workout gives a draft.
- At least 120 sentences in Spanish and 15 in English.

The script prints the exercise match rate, the set value accuracy, the failures by kind, the cost per
call and the median and 90th percentile latency, and writes every failure to `reports/<date>.md`
(ignored by git: the numbers that matter go in the spec's Progress).
