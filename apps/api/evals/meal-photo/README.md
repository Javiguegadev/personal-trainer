# Plate photo eval (spec 007 AC14)

Photos of real plates whose foods were weighed, to measure how well the plate photo finds the foods and
estimates the calories. Run it with `pnpm --filter @pt/api eval:meal-photo`. It calls the real model and
reads the catalog of the dev database, so it spends API money (about 0.001 USD per photo): ask before
running it.

## How to weigh a plate (about 30 of them, over two or three weeks of normal meals)

1. Put the empty plate on a kitchen scale and press "tare".
2. Add the foods one by one, pressing "tare" after each one, and write down the grams of each
   (oil included: weigh the bottle before and after pouring, or count the tablespoons at 10 g each).
3. Take the photo **before eating**, as you would in the app: from above or at 45°, the whole plate in
   the picture, normal light. Resize it to 1568 px on its longest side (the app does the same). JPEG.
4. Save it in `photos/` and add a line to `cases.jsonl`.

Variety matters more than number: Spanish dishes (lentejas, paella, tortilla, ensalada mixta,
filete con patatas, pasta), a breakfast, a sandwich, a bowl, a plate with a drink beside it, a dish with
hidden oil or sauce, a small and a large portion of the same dish. Also at least **5 photos without
food** (a menu, a person, a product label, an empty plate, a blurry photo).

## Format of `cases.jsonl`

One line per photo. `keys` are catalog keys (`packages/db/src/knowledge/catalog/foods.csv`) that count as
a right match, the reference first; `grams` are the weighed grams. A food the catalog lacks gets
`"keys": []` (it counts towards the weight of the plate but not towards "foods found").

```json
{"file": "lentejas-01.jpg", "expected": [{"keys": ["a-lentejas-estofadas"], "grams": 320}, {"keys": ["c-pan-blanco-barra"], "grams": 40}]}
{"file": "huevos-patatas.jpg", "expected": [{"keys": ["d-huevo-plancha", "d-huevo"], "grams": 110}, {"keys": ["b-patatas-fritas"], "grams": 150}, {"keys": ["f-aceite-oliva-virgen-extra"], "grams": 10}]}
{"file": "menu.jpg", "expected": [], "note": "a menu, no food"}
```

## Gate (provisional, for the professional reviewer)

- At least 80 % of the foods that weigh 10 % or more of the plate are found.
- The draft's kcal are within ±25 % of the weighed kcal in at least 70 % of the plates.
- The median error of the plate's kcal is at most 20 %.
- No photo without food gives items.

The script also prints the cost per call and the median and 90th percentile latency.
