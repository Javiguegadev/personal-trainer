# Food catalog review notes (spec 005)

Written while curating `packages/db/src/knowledge/catalog/foods.csv` (811 foods from Ciqual 2025). For the professional reviewer and for later sources (USDA, BEDCA once AESAN allows it). Per group: Spanish foods missing from Ciqual, approximate mappings to French or other records, and doubts.

## Group A-dishes

### Group A (prepared dishes): gaps

91 rows in `A-dishes.csv`.

### Missing

Common Spanish dishes with no reasonable CIQUAL 2025 match in this group (candidates for USDA, BEDCA or
a recipe calculation):

- Tortilla de patatas (with and without onion): no potato omelette in CIQUAL. Top priority, eaten daily.
- Croquetas (jamón, pollo, bacalao, cocido): CIQUAL "meat, poultry or fish fritters" (25551) has about
  twice the protein of a béchamel croqueta. Top priority.
- Cocido madrileño / puchero (chickpeas, meat, chorizo, morcilla, vegetables): pot-au-feu (25013) has no
  chickpeas and is far too lean.
- Callos a la madrileña: Provençal tripe (8612) has no chorizo or morcilla and is too lean.
- Salmorejo: gazpacho (25967) has much less bread and oil.
- Sopa de ajo / sopa castellana.
- Potaje de garbanzos, garbanzos con espinacas, garbanzos con chorizo.
- Fideuá, arroz negro, arroz a banda, arroz con pollo, arroz al horno (only paella exists).
- Empanada gallega de atún, empanadillas de atún (fried, wafer pastry).
- Bocadillo de calamares, bocadillo de tortilla, montaditos, serranito.
- Pechuga de pollo empanada: CIQUAL 36036 (breaded chicken escalope) looks wrong (339 kcal with 7.25 g
  protein per 100 g), so it was not used. Breaded turkey (36318) is in the CSV.
- Flamenquín, cachopo (veal cordon bleu 25089 exists but a cachopo is much bigger and fattier).
- Huevos rotos, migas, patatas a lo pobre, patatas bravas (could fit group B or D).
- Marmitako, pulpo a la gallega, merluza a la romana, pescaíto frito, calamares a la romana.
- Ensalada campera, escalivada, menestra de verduras, ajoblanco, porrusalda (only an approximate synonym
  on the leek and potato soup).
- Dürüm (only a synonym of the pita kebab row).

### Approximate mappings

- `a-ensaladilla-rusa` → 25664 "Potato salad, with tuna, prepacked". A real ensaladilla also has carrot,
  peas, egg and more mayonnaise; homemade fat is probably 10–15 g, not 7.7 g.
- `a-ensalada-mixta` → 25668 "Mixed salad with raw vegetables, egg and fish products, with sauce". Close
  to lettuce, tomato, tuna and egg with dressing.
- `a-lentejas-estofadas` → 25010 "Salt-cured pork belly with lentils" (petit salé aux lentilles). Macros
  (118 kcal, 8 P, 9 C, 5 F) are close to lentils stewed with chorizo. Carbs are a bit low.
- `a-fabada` → 25098 "White bean stew, with pork, canned" (cassoulet). No morcilla. A real fabada is
  fattier (about 150–180 kcal).
- `a-alubias-estofadas` → 25002 "White bean stew, canned".
- `a-pisto` → 25018 "Ratatouille". Very close. A homemade pisto may have more oil.
- `a-estofado-ternera` → 25065 "Beef stew with carrots". No potatoes.
- `a-pollo-chilindron` → 25190 "Chicken, Basque-style" (poulet basquaise: peppers and tomato).
- `a-pescado-tomate` → 25128 "White fish with Provençal-style sauce (tomato sauce)".
- `a-mejillones-marinera` → 10082 "Mussels, in onion and white wine broth" (moules marinières). The
  Spanish version has tomato and paprika.
- `a-caldo-carne` → 25909 "Broth or stock, meat and vegetables, dehydrated and reconstituted". A
  homemade cocido broth has more fat.
- `a-crema-verduras-verdes` → 25963 "Soup, green vegetables". Used for crema de calabacín, espinacas and
  brócoli (synonyms).
- `a-crema-puerros` → 25907 "Soup, leek and potato". Synonyms porrusalda and vichyssoise are
  approximate (porrusalda has more potato, vichyssoise has cream).
- `a-empanada-calamares` → 26268 "Pie, squid and spicy tomato sauce" (tielle sétoise). The bread-like
  crust and the filling are close to an empanada gallega de calamares or pulpo. "empanada gallega" is
  only a synonym.
- `a-empanadilla-carne` → 25402 "Meat puff pastry". Spanish empanadillas use wafer pastry and are often
  fried.
- `a-napolitana-jamon-queso` → 25396 "Ham and cheese puffed pastry, prepacked".
- `a-bocadillo-jamon` → 25517 "Sandwich, baguette, ham and butter, homemade" (jambon-beurre). A Spanish
  bocadillo uses jamón serrano with tomato and/or olive oil. Energy and fat are similar.
- `a-bocadillo-jamon-queso` → 25521 (with butter).
- `a-bocadillo-chorizo` → 25520 "Sandwich, baguette, dry sausage and butter". Saucisson sec, not chorizo.
- `a-bocadillo-lomo` → 25533 "Sandwich, baguette, pork, raw vegetables and mayonnaise".
- `a-sandwich-mixto` → 25547 "Toasted ham and cheese sandwich, prepacked" (croque-monsieur). Close.
- `a-sandwich-vegetal` → 25650 "Sandwich, club, wholemeal bread, tuna, egg and raw vegetables". Spanish
  sándwich vegetal is usually on white bread.
- `a-san-jacobo` → 25546 "Cheese with ham, breaded, prepacked". Good match.
- `a-filete-ternera-empanado` → 25173 "Milanese-style veal escalope". Good match.
- `a-pizza-carbonara` → 25570 "Pizza, lardoons onions and cheese". Spanish carbonara pizza also has
  cream.
- `a-pizza-bolonesa` → 25457 "Pizza, Bolognese-style with meat". "pizza barbacoa" is only a synonym (no
  BBQ sauce in the record).
- `a-pizza-pepperoni` → 25462 "Pizza, chorizo or salami".
- `a-kebab` → 25428 "Sandwich, pita bread, kebab and raw vegetables". "durum" is a synonym though the
  wrap is a different bread.
- `a-verduras-rellenas` → 25511 "Stuffed vegetables (excluding tomato)". Used for pimientos, calabacines
  and berenjenas rellenas.

### Doubts

- One CIQUAL code can only appear once (`foods` has a unique source + source_id), so "canelones" is a
  synonym of `a-lasana-carne` and `a-lasana-verduras` (CIQUAL groups lasagna and cannelloni together).
- `a-mejillones-marinera`: check whether CIQUAL values are per 100 g of mussels with shells and broth
  (10.3 g protein suggests a mix). The 250 g serving assumes the same basis.
- `a-alitas-pollo`: unclear whether values are per edible part. The 35 g per wing assumes edible part.
- `a-fideos-instantaneos`: values are for the cooked product. A cup is about 60–90 g dry plus water, so
  350 g prepared. Check against common Spanish cup sizes.
- `a-ensalada-atun-lata`: can sizes vary (150–220 g). Synonyms use brand names (Isabel, Calvo) and
  `a-sopa-fideos-sobre` uses "gallina blanca"; check the brand-name policy.
- `a-sushi`: 30 g per piece mixes nigiri (about 35 g) and maki (about 25 g).
- `a-bocadillo-*`: 200 g assumes half a barra (about 120 g bread) plus filling. Bar bocadillos can reach
  250–300 g.
- `a-kebab`: kebab sizes in Spain vary a lot (250–400 g).
- `a-pizza-*`: "1 porción (100 g)" is about 1/4 of a 350–400 g frozen pizza. Restaurant pizzas are bigger.
- `a-sopa-pescado`: CIQUAL mixes fish and crustacean soups. A Spanish sopa de marisco with rice or bread
  will be higher in carbs.
- Not used: dessert and ice-cream averages (24999, 39500) belong to group E.

## Group B-plants

### Group B (plants): gaps

### Missing

Common Spanish foods in this area with no reasonable CIQUAL match in `B-plants.in.tsv`:

- Aceitunas (verdes, negras, rellenas de anchoa): not in this input. CIQUAL has them in subgroup 1002
  (`13032` green in brine, `13033` black in brine, `13147` green stuffed), so they are in the F file.
  Group F should cover them, or they should be moved here.
- Ajo (garlic) and perejil (parsley): in CIQUAL subgroup 1006 (F file), not in this input.
- Pimientos de Padrón (fritos): no specific record. Raw green pepper (`20085`) does not account for the
  frying oil. USDA or BEDCA later.
- Cebolleta / cebolla tierna (raw): only "spring onion, sautéed without fat" (`20323`). Left out.
- Acelgas crudas (whole leaf): CIQUAL only has the raw stalk; included only cooked (`20301`).
- Alubias pintas, alubias negras / frijoles negros, judiones de La Granja, fabes asturianas: no specific
  record. Fabes and judiones are synonyms of the white bean rows for now.
- Altramuces (en salmuera, the snack): CIQUAL only has the dried seed (`20534`, 356 kcal); the brined
  snack is around 120 kcal. Left out.
- Garbanzos / lentejas / alubias "guisados" (with chorizo, potatoes, etc.) are dishes (group A).
- Pisto, escalivada, ensaladilla rusa, gazpacho, salmorejo: dishes (group A). Only the gazpacho record
  (`25967`) seems to exist in A.
- Patatas bravas, patatas a lo pobre (proper, fried in plenty of oil), tortilla de patatas: dishes (group A).
- Membrillo (dulce de membrillo): a sweet, belongs in group E. The fresh quince record (`13010`) was left out.
- Kikos (maíz frito): not in this input (cereal snack).
- Grelos, borraja, cardo crudo: borraja and grelos have no record; cardo only via `20241` (cooked, kept).
- Pimentón (spice), alcaparras, pepinillos en vinagre, guindillas en vinagre (banderillas): not in this input.
- Higos chumbos, nísperos and chirimoyas are covered; caqui is covered. Paraguayo has no specific record
  (synonym of melocotón for now).
- Zumos (naranja, etc.): in group E (`2013` orange juice fresh, etc.).

### Approximate mappings

- `b-cogollos` → `20288` Lettuce, sucrine, raw. Sucrine is the French little gem, the same type as the
  cogollo de Tudela.
- `b-tomate-triturado` → `20169` Tomato flesh without skin, canned (pulpe de tomate). Closest to Spanish
  tomate triturado/troceado (~25 kcal).
- `b-tomate-pera` → `20276` Tomato, round, raw. CIQUAL has no plum-tomato record; composition is the same.
- `b-pimiento-rojo-asado` → `20088` Sweet pepper, red, cooked. Generic cooked, without oil; roasted
  peppers dressed with olive oil (escalivada) carry more fat.
- `b-pimientos-piquillo` → `20275` Sweet pepper, red, canned, drained. Piquillo is a roasted canned red
  pepper; values should be close.
- `b-esparragos-blancos-conserva` → `20076` Asparagus, canned, drained. The CIQUAL record does not say
  white, but the canned asparagus sold in Spain is white.
- `b-esparragos-verdes-cocidos` → `20299` Asparagus, green, boiled. Used for trigueros a la plancha too
  (without the oil).
- `b-champinones-plancha` → `20125` Mushroom, sautéed without added fat. In Spain they are usually cooked
  with oil and garlic; the oil must be logged separately.
- `b-melon` → `13742` Melon, honeydew, raw (22 kcal). Piel de sapo is the closest variety but Spanish
  tables give it around 30–35 kcal. A dietitian should check, or replace with BEDCA/USDA.
- `b-patatas-fritas` → `4032` French fries, frozen, deep-fried (258 kcal, 11.9 g fat). Homemade chips
  fried in olive oil should be in the same range (BEDCA ~ 290 kcal); no CIQUAL record for homemade.
- `b-patatas-salteadas` → `4015` Potato, sautéed with fat (137 kcal, 5.7 g fat). Synonyms include
  "patatas a lo pobre" and "panaderas", which in a bar carry more oil (often 10–15 g fat). Underestimates
  those.
- `b-pure-verduras`, `b-pure-calabacin` → `20258` Vegetables mashed / `20264` Courgette puree. French
  purées (with some fat); Spanish "crema de verduras" can include potato, oil or cream.
- `b-menestra-congelada` → `20267` Spring vegetables, frozen (peas, potatoes, green beans, carrots,
  onions). Spanish frozen menestra is similar but often has artichoke and no potato.
- `b-macedonia-verduras` → `20051` Mixed diced vegetables, canned (the mix used for ensaladilla).
- `b-lentejas-secas` / `b-lentejas-cocidas` → CIQUAL averages (`20359`, `20360`); synonyms include
  pardina, which is close to the French green lentil.
- `b-lentejas-bote` → `20510` Lentil, seasoned, canned, drained. "Seasoned" may add a little salt/fat
  compared with plain Spanish jarred lentils.
- `b-alubias-blancas-*` → Haricot bean records; fabes and judiones are larger varieties with similar
  composition.
- `b-platano-macho-cocido` → `53101` Plantain banana, cooked (boiled). The synonyms "tostones",
  "patacón" and "plátano frito" are fried forms and carry much more fat. Consider removing those
  synonyms or adding a fried record from USDA.
- `b-pipas-girasol` → `15045` Sunflower seed, grilled, salted (shelled). Spanish pipas are sold in the
  shell; see Doubts.
- `b-frutos-secos-mezcla-naturales` → `15066` Seeds and peanuts, dried, unsalted (average). Generic
  average used for "frutos secos".
- `b-melocoton-almibar` → `13730` Peach, canned in light syrup, drained. Spanish melocotón en almíbar is
  usually in heavy syrup (slightly more sugar).
- `b-limon` → `13009` Lemon flesh. The "1 cucharada de zumo" serving uses flesh values; lemon juice
  (group E `2007`) is about the same.
- `b-boniato-asado` → `4102` Sweet potato, cooked (method not stated).

### Doubts

- Pipas con cáscara: the serving "1 bolsa pequeña con cáscara (25 g)" gives the grams of the edible
  part (a typical 45–50 g bag in the shell yields ~25 g of kernels). The label may confuse users; the UI
  may need a note, or a separate "in shell" food with a yield factor.
- Pistachos: servings are written "pelados" (shelled weight). Same issue as pipas.
- "Habichuelas" is used as a synonym of both judías verdes (Andalucía, Murcia) and alubias (Caribbean,
  some Spanish regions). Kept on both on purpose; search will show both.
- "Paraguayo" is a synonym of melocotón (flat peach); "pelón" and "briñón" of nectarina. Check that this is
  acceptable.
- "Ensalada" as a synonym of lechuga, and "hongos" of champiñones/setas: broad; a dietitian or product
  person may prefer to drop them.
- Tomate raw (`20385`, average) is the 9-popularity row; varieties (cherry, corazón de buey, pera) are kept
  as separate rows with lower popularity.
- Popularity of patatas fritas de freidora set to 8 because it is the default for "patatas fritas"; check.
- Rows trimmed to stay near 200 (available in the input if wanted): okra, hemp seed, dried tropical
  fruit, guava, fresh quince, canned pears/apricots in syrup, tapioca, raw plantain, raw peanuts,
  roasted hazelnuts, macadamia, boiled chestnuts, fresh broad beans, white cabbage, cooked kale, napa
  cabbage, pak choi, peas and carrots (canned), ratatouille vegetables (frozen), carrot puree, uncooked
  oven chips, roasted tomato, raw beetroot, lychee, romanesco, parsnip, watercress, snow peas.

## Group C-cereals-dairy

### Group C (cereals and dairy): gaps

154 rows in `C-cereals-dairy.csv`. Input subgroups: 0301 cereals and pasta, 0302 bread, 0303 salty
snacks, 0304 flours, 0305 doughs, 0501 milk, 0502 fresh dairy and dairy desserts, 0503 cheeses,
0504 cream.

### Not in this input (covered by group E)

The brief asked for breakfast cereals, galletas maría, magdalenas, croissant and churros. None of them
is in `C-cereals-dairy.in.tsv`: CIQUAL puts them in subgroups 0705 (viennoiseries: croissant, napolitana
de chocolate), 0706 (biscuits: "Butter biscuit (cookie)" 24015, a close match for galletas maría) and 0707
(breakfast cereals: corn flakes, muesli, chocolate cereals). Those subgroups are in
`E-drinks-sweets.in.tsv`, so group E should cover them. Group C has no rows for them, because every row
must point to a code from its own input.

### Missing (no reasonable CIQUAL match in this input)

- Churros / porras: not in CIQUAL (only savoury fritters). Take them from USDA or BEDCA.
- Picos / regañás (Andalusian bread sticks): no specific record. "picos" is a synonym on `c-colines`
  (grissini, 428 kcal), which is close but not exact. A dedicated record would be better.
- Pan de leche / bollos de leche (soft milk rolls): no record. Brioche sandwich bread (7210) is close
  for the sliced loaf only.
- Masa de empanadillas (obleas): no record. Puff and shortcrust pastry are much fattier.
- Harina de avena (oat flour): no record. It is a synonym on `c-copos-de-avena`, because the composition
  is the same as whole oats (see Doubts).
- Queso de tetilla, idiazábal, torta del casar, cabrales, mahón, San Simón, queso de Arzúa: Spanish PDO
  cheeses with no CIQUAL record. Possible proxies: idiazábal → Ossau-Iraty (12119), cabrales → queso
  azul/roquefort, mahón → semi-hard cow cheese. They are not added as synonyms, to avoid misleading
  matches.
- Queso cottage: no record. Quark 2–3 % fat (19646) has a different composition.
- Queso de Burgos 0 % / light: no matching record (the 0 % quark is too wet).
- Leche merengada, batido de chocolate (Cacaolat-type cocoa milk), leche con cacao: not in this input
  (probably in E's drinks). The CIQUAL fast-food milkshake (39001) was left out.
- Cuajada (plain, unsweetened): no specific record (see approximate mappings).
- Skyr: no specific record. It is a synonym on `c-yogur-proteinas-natural` (see Doubts).
- Nata para montar at 35–38 % fat: no exact record (see approximate mappings).
- Arroz bomba / arroz redondo: CIQUAL has only generic white rice. They are synonyms of
  `c-arroz-blanco-crudo`, which is a reasonable match for macros.

### Approximate mappings

- `c-pan-blanco-barra` → 7001 "Bread, French bread, baguette". The French baguette is a reasonable proxy
  for the Spanish barra (pistola, baguette).
- `c-pan-integral` → 7110 "French bread, wholemeal (flour type 150)". Spanish "integral" bread often
  mixes refined and wholemeal flour, so its fibre and kcal can be a little different.
- `c-pan-de-pueblo` → 7100 "French bread, country-style" (pain de campagne). Proxy for hogaza and pan de
  payés.
- `c-chapata` → 7170 "Bread, panini". Ciabatta and panini are close.
- `c-queso-fresco-burgos` → 12805 "Cheese, fresh, from goat's milk" (194 kcal, 12 g protein, 15 g fat).
  Spanish Burgos cheese (cow) is about 175–200 kcal, 12–15 g protein, 12–15 g fat, so the macros are
  close but the milk species is different.
- `c-requeson` → 12071 "Brousse" (French ewe's-milk whey cheese, similar to ricotta and requesón).
- `c-queso-tierno` → 12755 "Saint-Paulin, semi-hard cheese" (327 kcal). Proxy for queso tierno.
- `c-queso-semicurado` → 12816 "Hard cheese, from cow's milk" (359 kcal, 25.6 g protein, 28.8 g fat).
  Spanish semicurado (often mixed milk) is about 360–380 kcal.
- `c-queso-curado` → 12747 "Pyrénées firm cheese, from ewe's milk" (393 kcal). Proxy for aged ewe's or
  mixed-milk queso curado.
- `c-queso-manchego-curado` → 12119 "Ossau-Iraty, from ewe's milk" (423 kcal, 24 g protein, 36 g fat).
  Both are pressed ewe's-milk PDO cheeses. Cured manchego is usually reported at 390–430 kcal.
- `c-queso-light-lonchas` → 12116 "Hard cheese, emmental-type, reduced fat". Proxy for queso light en
  lonchas. Spanish light cheeses vary a lot.
- `c-cuajada` → 19882 "Yogurt, ewe's milk, plain, around 6% fat" (99 kcal). Cuajada is curdled ewe's
  milk with rennet, not fermented, but its composition is very similar. The CIQUAL "renneted milk"
  record (19678) is flavoured and sweetened (16 g carbs), so it was rejected.
- `c-natillas` / `c-natillas-chocolate` → 39229 / 39200 "Custard dessert, refrigerated" (French crème
  dessert). Spanish natillas contain egg yolk, while the French ones are usually thickened with starch.
  The macros are similar for supermarket natillas.
- `c-flan-de-huevo` → 19674 "Flan with eggs, refrigerated". OK for supermarket flan de huevo. A homemade
  flan with caramel is richer (about 150 kcal; see 39209 crème caramel).
- `c-flan-de-vainilla` → 19679 "Milk jelly covered with caramel". Matches flan without egg (Danone or
  powdered flan).
- `c-crema-catalana` → 39213 "Crème brûlée". It is close, but crème brûlée uses cream while crema
  catalana uses milk, so the real crema catalana is lighter (about 150–180 kcal versus 269).
  **Probably an overestimate**, check this.
- `c-torrija` → 39236 "French toast" (226 kcal). A fried Spanish torrija with sugar or honey is usually
  250–330 kcal/100 g. **Probably an underestimate**.
- `c-nata-para-montar` → 19417 "Cream 30% fat, liquid, UHT" (293 kcal). Spanish nata para montar is
  35–38 % fat (about 340 kcal).
- `c-nata-para-cocinar` → 19436 "Cream, 12–20% fat, light, fluid". Spanish nata para cocinar is
  usually 18–20 %.
- `c-yogur-de-soja-natural` / `c-yogur-de-soja-frutas` → CIQUAL "Soy dessert, fermented". These are the
  fermented soy alternatives, which are equivalent.
- `c-leche-fermentada-liquida` → 19516 (L. casei, flavoured, sweetened). Matches Actimel original.
- `c-patatas-tubo` → 38405 "Salty snacks, crackers, made from potato". Proxy for Pringles-type stacked
  crisps.

### Doubts (for a dietitian to check)

- `c-copos-de-avena` → 9310 "Oat, raw" (whole oat grain, 16.9 g protein, 55.7 g carbs). The values match
  rolled oats on Spanish labels (about 13 g protein, 60 g carbs) only roughly. The synonym "harina de
  avena" assumes that oat flour has the same composition.
- `c-yogur-proteinas-natural` has the synonym "skyr". CIQUAL's "Yoghurt, rich in protein, plain" has
  9.3 g protein, while skyr usually has 10–11 g. This is acceptable, but a separate skyr record would be
  better.
- `c-tortilla-de-maiz` → 7813 "Maize/corn tortilla wrap, to be filled" (316 kcal, 5.6 g fat) is a
  packaged wrap. A fresh Mexican corn tortilla is about 220 kcal with 3 g fat.
- `c-yogur-natural` → 19593 has 50 kcal. Spanish whole-milk plain yogurt labels say about 60–65 kcal
  (3 % fat versus 1.7 % here). Consider 19723 (63 kcal, 2.85 g fat), which is closer to Spanish whole
  plain yogurt but is fortified with vitamin D.
- `c-yogur-griego` → 19860 (103 kcal, 8.2 g fat). Spanish "yogur griego" (Danone, Hacendado) is about
  10 % fat and 130–140 kcal, and many labels add sugar. The values are probably low.
- Serving weights to confirm: pan de molde slice 25 g (Bimbo 25–28 g), packaged toast slice 9 g, quesito
  16 g, processed cheese slice 17 g, petit suisse 50 g (Danonino is 45–50 g), burrata 125 g, yogur
  griego 125 g (some brands sell 115 g or 4×120 g), and microwave popcorn bag 90 g (most of the bag is
  eaten).
- Gnocchi are logged raw (from the package, 176 kcal). Cooked gnocchi (25510, 178 kcal) are almost
  identical, so there is a single row.
- `c-queso-generico` (12999, CIQUAL average cheese) is a catch-all for "queso". Its popularity of 4 keeps
  it below the specific Spanish cheeses.
- `c-arroz-blanco-cocido` has popularity 8 and `c-arroz-blanco-crudo` has 7. Spanish home cooks often
  weigh rice raw, so the two values could be equal.

## Group D-meat-fish-eggs

### Group D (meat, poultry, cured meats, fish, seafood, eggs): gaps

171 rows in `D-meat-fish-eggs.csv`.

### Missing

Common Spanish foods with no reasonable CIQUAL match (candidates for USDA/BEDCA later):

- Lomo embuchado: lean cured pork loin. CIQUAL only has coppa (neck, about 20 g fat) and bresaola (beef). Neither is close enough.
- Sobrasada: spreadable cured paprika sausage (about 40 g fat or more). No equivalent.
- Chistorra and chorizo fresco (para cocinar): fresh paprika sausages. CIQUAL "chorizo" (30315) is the cured one.
- Longaniza (fresca and curada), butifarra blanca/negra cocida (Catalonia).
- Lacón (cured and cooked pork foreleg). Closest CIQUAL items are the cooked pork shoulder cold cut and the ham knuckle, but the cut and the cure differ.
- Secreto, presa, pluma ibéricos: fatty Iberian pork cuts (about 25–30 g fat). No Iberian pork in CIQUAL.
- Cochinillo asado, lechazo asado (lechazo is mapped loosely as a synonym of roast leg of lamb).
- Carne picada mixta (cerdo y ternera). CIQUAL 30052 is seasoned sausage meat (26.5 g fat, 4.4 g carbs), not plain mince.
- Hamburguesa de pollo / de pavo (supermarket patties with fillers).
- Pechuga de pollo cocida / hervida (only grilled breast exists).
- Pollo empanado, nuggets de pollo, San Jacobo, flamenquín, escalope milanesa (may be in group A).
- Callos (a la madrileña): CIQUAL only has raw beef tripe.
- Boquerones fritos, pescaíto frito, cazón en adobo, chopitos/puntillitas fritos.
- Sepia a la plancha, chipirones a la plancha (only raw cuttlefish exists; cooked squid is used for chipirones).
- Navajas, nécoras, percebes, quisquillas.
- Gulas (surimi angulas substitute) and angulas.
- Huevas de merluza cocidas.
- Atún en escabeche, mejillones en escabeche, caballa en aceite de oliva, ventresca de atún, melva.
- Huevo frito con aceite: CIQUAL only has "fried without added fat" (see Doubts).
- Pez espada / emperador cocinado: CIQUAL 26093 (baked swordfish) has 16.9 g fat, which is not plausible for swordfish, so no cooked row was added.

### Approximate mappings

- `d-jamon-iberico` → 28844 "Dry-cured ham, from Parma" (248 kcal, 15.4 g fat). It is the fattiest unsmoked dry-cured ham in CIQUAL. Real jamón ibérico (especially bellota) is fattier: often 20–30 g fat, 300–375 kcal. Replace with BEDCA/label data when available.
- `d-jamon-serrano` → 28845 "Dry-cured ham, Serrano". Direct CIQUAL record, listed here only because it is a French-market analysis.
- `d-chorizo` / `d-chorizo-lonchas` → 30315 / 30317 "Spicy pork sausage with red pepper". This is the CIQUAL chorizo record, cured. Fine for the generic chorizo; ibérico is fattier.
- `d-salchichon` → 30312 "Dry sausage, with pepper" (French saucisson au poivre ≈ salchichón).
- `d-fuet` → 30309 "Dry sausage, thin size" (thin saucisson sec ≈ fuet/espetec).
- `d-morcilla` / `d-morcilla-plancha` → 8703 / 8704 French "boudin noir". Spanish morcilla de Burgos (rice) and de cebolla have more carbohydrate (about 10–15 g) and usually less fat. Composition is only roughly close.
- `d-butifarra-cruda` → 30110 "Toulouse sausage, raw" (fresh pure-pork sausage, similar to butifarra fresca).
- `d-bacon` → 28502 "Pork belly, cured, smoked, raw" (Spanish supermarket bacon is smoked cured belly). `d-bacon-plancha` → 28725 "Lardoons, smoked, cooked".
- `d-cecina` → 28860 "Viande des Grisons or dried beef meat" (air-dried cured beef, the closest to cecina de León).
- `d-pate-cerdo` → 8305 "Pork liver pâté" (Spanish "foie-gras" spreads like La Piara are pork liver pâté).
- `d-paleta-cocida` → 28911 "Cooked pork shoulder, choice, rind less defatted".
- `d-carne-picada-cerdo` → 28475 "Pork, 90/10 trimming, raw" (lean pork trimmings used for mince).
- `d-carne-picada-pollo-pavo` → 28927 "Poultry, minced meat" (it is in the charcuterie subgroup and has 3.5 g carbs, so it may be a seasoned product).
- `d-hamburguesa-ternera-cruda` / `-plancha` → 6256 / 6257 "Beef, minced steak, 20% fat". Spanish burger meat ("burger meat") often contains water, fibre and salt; values are approximate.
- `d-lomo-cerdo-crudo` → 28480 "Pork, eye of shortloin, raw" (cinta de lomo). CIQUAL 28302 "Pork, loin, raw" has 18.8 g fat and looks like a fatty French cut (échine/longe), so it was not used.
- `d-lomo-cerdo-plancha` → 28301 "Pork, roast, cooked" (rôti de porc, usually loin). It is roasted, not grilled; values should be close for lean loin.
- `d-filete-ternera-crudo` / `-plancha` → 6521 / 6520 "Veal, escalope". In Spain "ternera" in the supermarket is mostly añojo (young beef), between veal and beef in composition. Both are lean, so the difference is small.
- `d-solomillo-ternera-crudo` / `-plancha` → 6522 / 6523 "Veal, tenderloin".
- `d-entrecot-plancha` → 6100 "Beef, rib steak, lean, grilled/pan-fried" (lean only: a whole entrecot with its fat is fattier). The raw row (6103) includes the fat.
- `d-redondo-ternera-asado` → 6551 "Veal, roast, cooked".
- `d-costillas-cerdo-asadas` → 28401 "Pork, spare-ribs, braised" (braised, used for asadas/barbacoa too; sauces not included).
- `d-codillo-cerdo` → 28960 "Knuckle of ham, cooked".
- `d-oreja-cerdo` → 28530 "Pig's ear, brined" (not specified as cooked).
- `d-higado-ternera-plancha` → 40107 "Liver, calf, cooked". The synonym "higado encebollado" ignores the onion and oil.
- `d-merluza-cocinada` → 26120 "European hake, braised" (used for horno/plancha/vapor).
- `d-merluza-congelada` → 26048 "Hake, fillet, frozen, raw" (species not specified, may be Cape hake).
- `d-varitas-pescado` → 26029 "Fish, breaded, frozen, raw" (generic breaded fish, not hake specifically).
- `d-pescado-rebozado-frito` → 26030 "Fish, breaded, fried, prepacked".
- `d-boquerones-vinagre` → 26000 "Anchovy, fillets, marinated in oil, semi-preserved, drained". Spanish boquerones en vinagre are marinated in vinegar and then dressed with oil; values should be close but fat may be lower.
- `d-anchoas-aceite` → 26694 "Anchovy, fillets, salted, in olive oil".
- `d-atun-aceite` → 26180 "Tuna, whole slice, in sunflower oil, canned, drained". CIQUAL has no tuna in olive oil; drained values are similar. Synonyms cover both oils.
- `d-atun-tomate` → 26243 "Tuna, in Catalan-style or tomato sauce, canned" (not drained).
- `d-bonito-fresco-crudo` → 26076 "Albacore, raw" (bonito del norte = Thunnus alalunga).
- `d-caballa-conserva` → 26123 "Mackerel, fillet, canned in brine, drained". Most Spanish canned caballa is in olive oil; drained values are close but probably a bit fattier.
- `d-lubina-cruda` → 26206 "Mediterranean bass, raw, farmed" (farmed is what is sold). `d-lubina-horno` → 27030 "European bass, roasted/baked" (no wild/farmed flag).
- `d-dorada-horno` → 27031 "Gilthead seabream, roasted/baked" (used for a la sal / a la espalda / plancha too).
- `d-gallo-crudo` → 26084 "Megrim, raw" (gallo = Lepidorhombus).
- `d-besugo-crudo` → 26109 "Blackspot seabream, raw" (besugo = Pagellus bogaraveo).
- `d-abadejo-congelado` → 26006 "Alaska pollock, raw" (what supermarkets sell as "abadejo" frozen fillets).
- `d-calamar-cocinado` → 10037 "Squid, boiled". It is boiled, used also for plancha and chipirones. It has 32.5 g protein (high water loss), so plancha portions may be overestimated.
- `d-calamares-fritos` → 10084 "Squid, fried or pan-fried, with fat" (8.45 g carbs, likely floured: close to rabas / calamares fritos).
- `d-calamares-romana` → 10002 "Squid fritter, Roman-style, prepacked" (frozen battered rings; bar portions fried in oil will be fattier).
- `d-pulpo-cocido` → 10079 "Octopus, common, cooked". Pulpo a la gallega also has olive oil and paprika (not included).
- `d-langostinos-cocidos` → 10062 "Tropical tiger prawn, boiled".
- `d-buey-mar-cocido` → 10025 "Crab, boiled" (probably brown crab, Cancer pagurus).
- `d-centollo-cocido` → 10057 "Spinous spider crab, boiled".
- `d-berberechos` → 10034 "Cockle, cooked" (Spanish berberechos are mostly canned in brine; values should be close).
- `d-marisco-congelado` → 10080 "Seafood, cooked, frozen" (generic mix).
- `d-tortilla-patatas` → 22510 "Spanish-style tortilla with onions, prepacked" (165 kcal, 9.9 g fat). A home-made or bar tortilla usually has more oil (about 180–230 kcal, 12–16 g fat). Also check that group A does not add its own tortilla row.
- `d-huevo-plancha` → 22505 "Egg, fried, without added fat" (see Doubts).

### Doubts

- Huevo frito: the synonym "huevo frito" points to the no-added-fat record. A Spanish fried egg absorbs about 5–10 g of oil. Options: keep it and let users log the oil separately, add a USDA "egg, fried" row, or build it as a recipe (egg + oil). The synonym may be better removed.
- Egg servings: per the instructions, a medium egg is 55 g and a large egg 65 g (edible part). Spanish sizes M (53–63 g) and L (63–73 g) include the shell (about 10 %), so the edible parts are closer to 50 g and 60 g. A dietitian should decide.
- Lamb chops: CIQUAL raw chop (21521, 21.5 g fat) and grilled chop (21524, 5.8 g fat) are not consistent (the grilled value is probably lean only). Chuletillas eaten with the fat sit in between.
- Rabbit raw (34001) has 11.6 g fat, high for farmed rabbit (usually 4–6 g). The braised row (34000) has 8.4 g.
- Beef "Filete de ternera" mapped to veal; "Entrecot" and "Chuletón" mapped to beef. Check that the split matches how Spanish users think about "ternera" vs "vaca/buey".
- "Pescadilla" is a synonym of merluza (it is young hake in most of Spain). In some regions pescadilla means whiting (CIQUAL "Whiting" 26095), which was not included.
- "Bonito" as a synonym of bonito del norte (albacore): in southern Spain "bonito" may also mean Atlantic bonito (Sarda sarda, CIQUAL 26101), which is fattier.
- "Abadejo" synonym: in Spain it can mean Pollachius pollachius (CIQUAL 26129) or Alaska pollock fillets; the row uses Alaska pollock.
- "Foie" / "foie gras de cerdo" as synonyms of pork liver pâté: correct for the common supermarket spread, but someone typing "foie" in a restaurant context means duck foie gras (not in the catalog; CIQUAL 8323 is available).
- Canned servings: small tuna can drained = 52 g (3 x 80 g packs), sardine can drained = 85 g, mussel can drained = 70 g, cockle can drained = 63 g, anchovy can drained = 30 g. Brands vary.
- Whole-fish servings (dorada, lubina, lenguado, trucha, gallo) are the edible part of one medium fish, not the raw weight with bones.
- Left out on purpose (CIQUAL has them, low use in Spain): gallina, mollejas, codorniz, manitas, tocino, foie gras de pato, panceta curada, taquitos de jamón cocido, lengua, rosbif, jabalí, ciervo, caballo, bogavante, langosta, congrio, mero, tilapia, ostras, arenque, sucedáneo de caviar, offal other than liver. Easy to add if wanted.

## Group E-drinks-sweets

### Group E (drinks, sugar and confectionery, ice cream): gaps

127 rows written in `E-drinks-sweets.csv`. Note: breakfast cereals, oat flakes, biscuits and cereal bars
(CIQUAL subgroups 0706 to 0708) were only in this group's input, so the common ones are included here.

### Missing

- Café cortado: CIQUAL has espresso and "coffee with milk" but no cortado (espresso with a dash of milk,
  about 15-20 kcal per 60 g). Could be modelled as café solo + leche, or taken from BEDCA/USDA.
- Café con leche with whole milk / café bombón (with condensed milk): only one generic coffee-with-milk
  record exists.
- Chocolate a la taza (thick Spanish hot chocolate, often with churros): no match.
- Horchata de chufa: no match (typical in Valencia, about 70-80 kcal/100 g).
- Granizado de limón / café: no match (sorbet is too solid an approximation).
- Tinto de verano (red wine + gaseosa / lemon soda): no prepared record; sangría is not equivalent.
- Cubata / gin tonic / ron cola / calimocho as mixed drinks: only the spirits and mixers separately.
- Vino fino / manzanilla (Jerez, dry fortified wine 15 %): no match.
- Crema de orujo / licor de crema (Baileys type): no cream liqueur in CIQUAL.
- Turrón (Jijona blando, Alicante duro, chocolate): CIQUAL "nougat, soft" (Montélimar, 437 kcal, 14 g
  fat) is far from turrón (about 500-560 kcal, 25-35 g fat). Not mapped.
- Polvorones and mantecados: shortbread records are butter-based and leaner; not mapped.
- Dulce de membrillo: CIQUAL "fruit jelly or fruit paste" (pâte de fruits, 77 g carbs) is much sweeter
  than membrillo; not mapped.
- Ensaimada (not in CIQUAL), churros/porras (may be in another group), torrijas, rosquillas de anís,
  carbayones.
- Tostadas / biscotes (pan tostado): not in this input (they are in group C, cereals).
- Tarta de Santiago (almond cake): no close record (financier is the nearest but different).
- Sándwich de nata (ice cream sandwich) and corte de helado: no match.
- Leche merengada, natillas and flan are dairy desserts (other group).

### Approximate mappings

- `e-cafe-con-leche` → 18151 "Coffee with milk or white coffee or cappuccino, ready-to-drink" (22 kcal):
  generic coffee-with-milk; a Spanish café con leche with half semi-skimmed milk is about 25 kcal, so it
  is close, but whole milk would be higher.
- `e-refresco-naranja-limon` → 18049 "Carbonated fruit soft drink, fruit < 10 %, with sugar(s)": Fanta/Kas
  type; Kas and some Fanta flavours use sugar + sweeteners (slightly fewer kcal).
- `e-refresco-lima-limon` → 18010 "Lemonade, with sugar(s)": French "limonade" is a clear sweet
  lemon soda (Sprite / 7up type).
- `e-clara` → 5004 "Shandy (beer + lemonade)": Spanish clara with gaseosa or lemon soda.
- `e-vermut` → 1007 "Wine-based aperitif": vermouth is a wine-based aperitif; Spanish red vermut is
  usually a bit sweeter.
- `e-licor` → 1003 "Liqueur" (generic, 225 kcal): pacharán and licor de hierbas vary in sugar and alcohol.
- `e-magdalena` → 24632 "Madeleine cake, prepacked": French madeleine, composition very close to the
  Spanish magdalena.
- `e-sobao` → 23081 "Butter pound cake, prepacked": sobao pasiego is a butter sponge cake of similar
  composition.
- `e-roscon-reyes` → 7744 "Christmas brioche with candied fruits, prepacked": roscón without cream filling;
  filled roscón (nata/trufa) is much higher in fat.
- `e-bizcocho` → 23594 "Soft cake, plain, sponge cake type, prepacked".
- `e-bollo-chocolate` → 7735 "Brioche with chocolate chips or filled with chocolate": Bollycao type.
- `e-pastelito-chocolate` → 23945 "Soft cake filled with chocolate and milk, chocolate coating":
  Phoskitos / Tigretón type.
- `e-palmera-chocolate` → 24658 "Biscuit puff pastry, with chocolate covering" (packaged): bakery palmeras
  de chocolate are similar per 100 g.
- `e-barrita-barquillo-chocolate` → 24311 "Wafer biscuit, filled or coated with chocolate": Kit Kat and
  Huesitos.
- `e-galletas-maria` → 24001 "Biscuit (cookie), plain" (biscuit sec, 438 kcal, 11.5 g fat): the closest to galleta María, which is made with vegetable oil (about 440-450 kcal, 10-14 g fat). 24015 "Butter biscuit" is kept as a separate row (galletas de mantequilla) because María has no butter.
- `e-galletas-integrales` → 24020 "Biscuit from whole grain cereals": digestive type.
- `e-galletas-rellenas-chocolate` → 24231 "Biscuit, snack with chocolate filling": Príncipe type.
- `e-copos-trigo-arroz` → 32030 "Cereal flakes, plain, with sugar(s), fortified": Special K / Fitness type.
- `e-tortitas` → 23827 "Pancake, with sugar(s), prepacked": packaged pancakes; homemade ones differ.
- `e-helado` → 39527 "Ice cream, box or cup (average)": generic for any flavour.
- `e-chocolatina-rellena` → 31001 "Chocolate bar, chocolate-coated, without biscuit": Mars / Milky Way.

### Doubts

- Spirits are logged in grams: 1 copa for a long drink = 50 g (about 50-55 ml at 40 % vol), chupito
  30 g. Spanish bar pours are often 60-70 ml; a dietitian may want a "copa generosa (70 g)".
- Café solo = 40 g (espresso cup with about 30-40 ml); the CIQUAL espresso value (7 kcal/100 g) is fine.
- Cava/champán served as 1 copa (120 g), still wine as 1 copa (150 g) and 1 chato (100 g).
- Cacao soluble: 1 cucharada (10 g) is a level spoon; many people use a heaped one (15 g).
- `e-leche-con-cacao` (18104) assumes semi-skimmed milk with cocoa powder; people may prefer to log milk +
  cacao soluble separately.
- Sacarina/stevia sachets set at 1 g; tabletop stevia sachets are mostly erythritol and weigh 1-2 g.
- Napolitana de chocolate set at 80 g (Spanish bakery size, larger than the French 60-65 g); packaged ones
  are about 45-60 g.
- "Cerveza sin alcohol" uses the CIQUAL record for < 1.2 % alcohol (29 kcal); Spanish 0,0 beers are often
  lower (about 15-25 kcal).
- "Agua" is a synonym of both agua mineral (9) and agua del grifo (8); search tie-break picks mineral
  first.
- Left out to keep the list short (available in CIQUAL if needed later): zumo de tomate, zumo de limón,
  cola sin cafeína, refresco zero de naranja/limón, gaseosa (18016), bebida de soja con calcio, bebida de
  arroz, cerveza negra, vino dulce, orujo, caramelo líquido, more jam flavours (albaricoque, naranja,
  melocotón), chocolate para fundir, chocolate con almendras, regaliz, peladillas, garrapiñadas,
  tarta de frutas, galletas Lotus (speculoos), barquillos, arroz inflado, granola de chocolate,
  helado premium, sorbete, chicle.

## Group F-fats-misc

### Group F (fats, sauces, condiments, spices, cooking aids, vegetarian): gaps

### Missing

- Aceite de oliva (suave / intenso, refined "aceite de oliva" without "virgen"): CIQUAL only has extra virgin
  (17270). Macros are practically identical, so "aceite de oliva" is a synonym of `f-aceite-oliva-virgen-extra`;
  a separate row would need another source (USDA "Oil, olive, salad or cooking") because `source_id` must be unique.
- Aceite de oliva virgen (not extra) and aceite de orujo de oliva: no CIQUAL record; same macros as olive oil.
- Salsa brava: typical bar sauce (patatas bravas), no match.
- Mojo picón / mojo verde (Canarias): no match.
- Sofrito (tomato, onion, olive oil): no match; tomate frito is the closest but has much less fat.
- Romesco / salsa de calçots: no match.
- Salsa verde (parsley, garlic, olive oil, for fish): no match.
- Mayonesa casera / alioli casero (pure oil + egg or garlic, ~75-80 % fat): CIQUAL only has prepacked versions.
- Pimentón picante as a separate item: same composition as pimentón dulce, kept as synonym.
- Pimiento choricero / carne de ñora: no match.
- Vinagre de Jerez / de manzana as separate items: covered by the generic `f-vinagre`.
- Sal baja en sodio (sal con potasio): no match.
- Edulcorantes (sacarina, stevia, sucralosa en pastillas o líquido): not in this input (maybe group E).
- Bebida vegetal de soja, crema de cacahuete, tahini: not in this input (expected in drinks / nuts groups).
- Heura and other branded plant-based meats: no match; `f-soja-texturizada` is only a rough stand-in, so
  "heura" was NOT added as a synonym.
- Alga wakame (Undaria pinnatifida, the one sold in Spain): CIQUAL only has Atlantic wakame (Alaria
  esculenta), not added.
- Caldo líquido envasado (caldo de pollo / de verduras en brik, very common in Spain): CIQUAL only has
  dehydrated stocks and a ready fish/veal stock; take caldo de pollo en brik from USDA/BEDCA.

### Approximate mappings

- `f-tomate-frito` → 11107 "Tomato sauce, with onions, prepacked" (79 kcal, 1.5 P, 7.7 C, 4.2 F). Spanish
  tomate frito (Orlando, Solís, Hacendado) is about 70-85 kcal, 1.5 P, 8-10 C, 3.5-5 F: close enough.
- `f-alioli` → 11168 "Aioli sauce, prepacked" (50 % fat, 480 kcal). Supermarket alioli in Spain is similar;
  homemade allioli (oil + garlic only) is much higher (~800 kcal).
- `f-salsa-rosa` → 11244 "Cocktail style sauce, prepacked" (572 kcal, 59 % fat). Spanish salsa rosa
  (mayonesa + kétchup) is usually 350-500 kcal; this record is on the high side.
- `f-margarina` → 16591 "Spreadable fat 41-62 % fat, unsalted, standard" (540 kcal, 60 % fat). Most Spanish
  tubs (Tulipán, Flora) are around 55-70 % fat; picked the middle band.
- `f-margarina-light` → 16592 "Spreadable fat <= 41 % fat" (366 kcal).
- `f-mantequilla` → 16400 unsalted 80 % fat; most butter sold in Spain is sin sal.
- `f-aceitunas-rellenas` → 13147 "Olive, green, stuffed (anchovy, sweet peppers, etc.)": generic for
  rellenas de anchoa / pimiento.
- `f-comino` → 11042 "Cumin, seed": used for ground cumin too (same composition).
- `f-caldo-pastilla-carne` → 11001 "Broth or stock, beef, dehydrated" and `f-caldo-pastilla-pollo` → 11174
  "Broth or stock, poultry, dehydrated": per 100 g of dry product. Spanish cubes (Avecrem, Starlux) often
  have more fat (15-25 g/100 g) than these records.
- `f-levadura-nutricional` → 11009 "Yeast, flakes": "levadura de cerveza" (brewer's yeast) added as synonym;
  composition is similar but not identical.
- `f-soja-texturizada` → 20591 "Soy protein, textured, rehydrated": values are for the hydrated product,
  while people often weigh it dry (dry is ~330-350 kcal, ~50 g protein). See doubts.
- `f-hierbabuena` → 11027 "Mint, fresh": hierbabuena (Mentha spicata) logged with generic mint values.
- `f-alga-nori` → 20987 "Laver (Porphyra sp.), dried": nori is Porphyra/Pyropia, good match.
- `f-salsa-bolonesa` → 11114 "Bolognese sauce or tomato sauce with meat, prepacked": jarred sauce, a
  homemade boloñesa has more meat and fat.

### Doubts

- Salt (`f-sal`) is 0 kcal; it is included so users can find it, but logging it adds no energy. Consider
  hiding 0 kcal items from "recent" suggestions, or tracking sodium later.
- Tiny servings with decimals (azafrán 0.1 g, laurel 0.2 g, pizca 0.3-0.5 g): the parser accepts decimals with
  a dot; check the UI rounds sensibly.
- Butter and margarine "1 cucharada (12 g)": a level tablespoon of butter is 12-14 g; "porción individual"
  (hotel portion) in Spain is 10-15 g, 10 g used.
- Oil "1 chorrito (7 g)": very variable (5-15 g); a dietitian may prefer 10 g. Most common serving is the
  cucharada (10 g, as requested).
- "manteca" is a synonym of both mantequilla (Argentina/Uruguay) and manteca de cerdo (Spain). Popularity
  (7 vs 2) makes mantequilla appear first; check this is the intended behaviour for Spanish users.
- `f-soja-texturizada` is the rehydrated form; consider adding the dry form from another source, since most
  people weigh it dry.
- Tofu block 200 g: Spanish packs range from 200 to 400 g.
- Leche de coco: 400 g can (≈ 400 ml). Light coconut milk (~ 7 % fat) has no record.
- Spice teaspoon weights are approximate (ground 2-2.5 g, dried leaves 1 g).
