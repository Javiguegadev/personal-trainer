---
name: knowledge-import
description: Add or update a knowledge-base source (food composition DBs like BEDCA/USDA/CIQUAL/Open Food Facts, exercise DBs like wger, MET compendium, WHO/EFSA/ISSN guidelines, study summaries) that grounds the AI. Use when the AI needs data it doesn't have, or to refresh a source.
---

# Knowledge import

The AI is grounded, not fine-tuned: it answers from these tables through tools. Data quality here is
answer quality there.

1. **License first.** Find the source's license and terms of use and write them in the spec: attribution
   text, share-alike, commercial use, redistribution. If unclear or restrictive, stop and ask the human.
   Never import full copyrighted texts (papers, books). Store summaries written by us plus a citation.
2. **Register the source** in `knowledge_sources` (name, url, license, version, imported_at).
3. **Importer** in `packages/db/src/knowledge/<source>/`: download (cache raw files outside git), parse,
   normalize (per 100 g, metric, kcal; Spanish and English names), dedupe against existing rows, and keep
   `source` + `source_id` on every row. Make it idempotent (re-running updates, never duplicates).
4. **Structured data** (foods, exercises, MET values) goes into regular tables with full-text + trigram
   indexes. **Text** (guidelines, study summaries) goes into `knowledge_chunks` with a citation and an
   embedding.
5. **Tests**: unit tests for the parser on a small fixture file, and spot checks against known values
   (e.g. olive oil ≈ 884 kcal/100 g, chicken breast ≈ 23 g protein/100 g raw).
6. **Expose it** through the relevant AI tool (`search_foods`, `get_guideline`…) and add eval cases that
   need the new data.
7. Add the attribution to the in-app "Data sources" screen and to the README.
8. Report: rows imported, rows skipped (and why), license notes, and evals affected.
