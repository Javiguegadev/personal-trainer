# Label reading eval (spec 006 AC20)

Photos of real nutrition labels with their values typed by hand, to measure how well the model reads
them. Run it with `pnpm --filter @pt/api eval:label-scan`. It calls the real model, so it spends API
money (about 0.0005 USD per photo): ask before running it.

## What to add

- `photos/`: at least 30 photos of products sold in Spain, as a user would take them. Resize each one
  to 1568 px on its longest side (the app does the same before it sends a photo). JPEG, PNG or WebP.
- `cases.jsonl`: one line per photo.

The set needs variety, because the easy label is not where the model fails:

- two columns (per 100 g and per serving), and labels with only a per-serving column;
- energy in kJ and kcal, and at least one label with kJ only;
- curved or shiny packages, small print, a photo taken at an angle;
- labels in several languages;
- drinks labelled per 100 ml;
- values printed as "trazas" or "< 0,5 g";
- at least 5 photos that cannot be read: not a label (a plate, the front of a package), a blurry
  photo, a table cut in half.

## Format of `cases.jsonl`

A readable label: the values **per 100 g or ml**, as the package prints them (convert per-serving
labels by hand). `fiberG` only when the label prints it.

```json
{"file": "galletas-maria.jpg", "expected": {"status": "ok", "unit": "g", "kcal": 436, "proteinG": 7.1, "carbsG": 76, "fatG": 10.5, "fiberG": 2.6}}
{"file": "zumo-naranja.jpg", "expected": {"status": "ok", "unit": "ml", "kcal": 43, "proteinG": 0.7, "carbsG": 9, "fatG": 0.1}}
{"file": "plato-lentejas.jpg", "expected": {"status": "unreadable"}, "note": "not a label"}
```

## Gate

At least 95 % of the readable photos give every required value exactly (unit, kcal, protein,
carbohydrates and fat; fiber when expected), and no unreadable photo gives values. The script also
prints the cost per call.
