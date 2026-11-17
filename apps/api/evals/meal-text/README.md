# Sentence eval (spec 007 AC13)

Meal sentences as people type or dictate them, with the catalog foods and grams that a right draft
would hold. Run it with `pnpm --filter @pt/api eval:meal-text`. It calls the real model and reads the
catalog of the dev database, so it spends API money (about 0.0005 USD per sentence): ask before
running it.

The cases (`cases.jsonl`) were written by an agent that saw only the catalog (names, synonyms and
servings), not the prompt. Review a sample by hand before trusting the numbers.

## Format of `cases.jsonl`

```json
{"text": "2 huevos a la plancha y 200 ml de leche", "kind": "counted_servings", "explicit": true, "expected": [{"keys": ["d-huevo-plancha", "d-huevo"], "grams": 110}, {"keys": ["c-leche-semidesnatada", "c-leche-entera"], "grams": 200}]}
{"text": "hola que tal", "kind": "not_food", "explicit": false, "expected": []}
```

- `keys`: catalog keys that count as a right match, the reference first; `[]` for a food the catalog
  lacks (the draft should leave it unresolved).
- `grams`: the reference amount (ml count as grams).
- `explicit`: every quantity is said in grams or ml, or as a count of a serving the catalog has. Only
  these sentences are checked against the ±5 % kcal criterion of stage E4.

## Gate

- At least 90 % of the expected foods are matched to an accepted key.
- At most 5 % of the draft items are foods that were not mentioned.
- At least 90 % of the explicit sentences give kcal within ±5 % of the reference.
- No sentence without food gives items. At least 120 sentences.

The script also prints the cost per call and the median and 90th percentile latency.
