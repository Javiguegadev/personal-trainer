/**
 * AC24 against the real dev database: deleting the auth user leaves no row that references it, and
 * `ai_usage` rows survive without a user id. Opt-in (it creates and deletes a real auth user):
 *
 *   pnpm --filter @pt/api test:integration
 *
 * Skipped unless DATABASE_URL, SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
 * are set. Never point it at production.
 */
import { CONSENT_VERSION } from '@pt/contracts';
import { addDays } from '@pt/core';
import { createDb, eq, schema, sql } from '@pt/db';
import { afterAll, describe, expect, it } from 'vitest';
import { profileInput } from '../test/fakes';
import { createDrizzleStore } from './drizzle-store';
import { createSupabaseAuthAdmin } from './supabase-admin';

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const { DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const enabled = Boolean(supabaseUrl && DATABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

/** Every table that holds user rows. Add a table here only together with its rows in the test below. */
const COVERED_USER_TABLES = [
  'profiles',
  'body_measurements',
  'lifestyle_profiles',
  'training_profiles',
  'planned_activities',
  'dietary_prefs',
  'nutrition_targets',
  'consents',
  'ai_usage',
  'meal_items',
  'favourite_foods',
  // Spec 006: the user's own foods (`owner_id`); catalog foods and products have no owner.
  'foods',
  // Spec 009: the training log and the user's own exercises (`owner_id`).
  'exercises',
  'workouts',
  'workout_sets',
  // Spec 010: the typical week and the routine.
  'work_blocks',
  'planned_activity_days',
  'workout_programs',
  'program_sessions',
  'program_exercises',
  // Spec 011: the daily check-in.
  'daily_checkins',
] as const;

describe.skipIf(!enabled)('account deletion (AC24, dev DB)', () => {
  const db = enabled ? createDb(DATABASE_URL as string) : (null as never);
  let userId: string | null = null;

  afterAll(async () => {
    if (userId) {
      await createSupabaseAuthAdmin({
        supabaseUrl: supabaseUrl as string,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY as string,
      }).deleteUser(userId);
    }
    await db?.$client.end();
  });

  it('cascades every user row and unlinks ai_usage', async () => {
    const base = (supabaseUrl as string).replace(/\/+$/, '');
    const key = SUPABASE_SERVICE_ROLE_KEY as string;
    const created = await fetch(`${base}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `ac24-${crypto.randomUUID()}@example.test`,
        email_confirm: true,
      }),
    });
    expect(created.status).toBe(200);
    userId = ((await created.json()) as { id: string }).id;
    const id = userId;

    const store = createDrizzleStore(db);
    const now = new Date();
    const TODAY = now.toISOString().slice(0, 10);
    const input = profileInput();
    await store.grantConsent(id, 'health_data', CONSENT_VERSION, now);
    await store.saveProfile(
      id,
      {
        profile: {
          sex: input.sex,
          birthDate: input.birthDate,
          heightCm: input.heightCm,
          weightKg: input.weightKg,
          targetWeightKg: input.targetWeightKg,
          jobActivity: 'standing',
          plannedActivities: [
            {
              kind: 'sport',
              label: 'fútbol',
              sessionsPerWeek: 2,
              minutesPerSession: 90,
              intensity: 'moderate',
              days: [],
            },
          ],
          requestedGoal: input.goal,
          goal: input.goal,
          trainingFocus: 'sport_performance',
          safetyFlags: [],
          injuries: null,
          units: input.units,
          locale: input.locale,
        },
        dietaryPrefs: input.dietaryPrefs,
        targets: {
          kcal: 1800,
          proteinG: 126,
          carbsG: 196,
          fatG: 50,
          fiberG: 25,
          formulaVersion: 'targets-v2',
          clampedReason: null,
        },
        today: TODAY,
      },
      now,
    );
    await store.recordAiUsage(
      id,
      {
        feature: 'label_scan',
        model: 'claude-haiku-5-5',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        latencyMs: 1,
        status: 'ok',
      },
      now,
    );
    const [usageRow] = await db
      .select({ id: schema.aiUsage.id })
      .from(schema.aiUsage)
      .where(eq(schema.aiUsage.userId, id));
    expect(usageRow).toBeDefined();
    const me = await store.getMe(id);
    expect(me.targets?.kcal).toBe(1800);
    expect(me.profile).toMatchObject({
      jobActivity: 'standing',
      trainingFocus: 'sport_performance',
      plannedActivities: [{ kind: 'sport', label: 'fútbol', sessionsPerWeek: 2 }],
    });
    expect((await store.exportUser(id)).profile).toMatchObject({
      trainingFocus: 'sport_performance',
      plannedActivities: [{ kind: 'sport' }],
    });

    // Spec 003: the profile save stored today's entry (AC13); a write recorded earlier loses (AC20);
    // the latest weight reaches the profile and the targets in one transaction (AC10).
    expect(await store.listWeights(id, TODAY, TODAY)).toEqual([
      { localDate: TODAY, weightKg: input.weightKg, recordedAt: now.toISOString() },
    ]);
    const stale = await store.writeWeight(
      id,
      {
        localDate: TODAY,
        recentFrom: TODAY,
        entry: { weightKg: 90, recordedAt: new Date(now.getTime() - 60_000).toISOString() },
      },
      () => null,
      now,
    );
    expect(stale?.entry?.weightKg).toBe(input.weightKg);
    const later = new Date(now.getTime() + 1000);
    const written = await store.writeWeight(
      id,
      {
        localDate: TODAY,
        recentFrom: TODAY,
        entry: { weightKg: 69.4, recordedAt: later.toISOString() },
      },
      ({ profile, latest }) => ({
        weightKg: latest?.weightKg ?? profile.weightKg,
        goal: 'maintain',
        safetyFlags: ['low_bmi'],
        newTargets: {
          kcal: 2000,
          proteinG: 120,
          carbsG: 240,
          fatG: 60,
          fiberG: 28,
          formulaVersion: 'targets-v2',
          clampedReason: null,
        },
      }),
      later,
    );
    expect(written).toMatchObject({ entry: { weightKg: 69.4 }, previousTargets: { kcal: 1800 } });
    expect(await store.getSafetyContext(id, TODAY)).toMatchObject({
      flags: ['low_bmi'],
      weightKg: 69.4,
      weights: [{ localDate: TODAY, weightKg: 69.4 }],
    });
    const after = await store.getMe(id);
    expect(after.profile).toMatchObject({
      weightKg: 69.4,
      goal: 'maintain',
      safetyFlags: ['low_bmi'],
    });
    expect(after.targets?.kcal).toBe(2000);
    const exported = await store.exportUser(id);
    expect(exported.weights).toHaveLength(1);
    expect(exported.targets).toHaveLength(2);
    const removed = await store.writeWeight(
      id,
      { localDate: TODAY, recentFrom: TODAY, entry: null },
      () => null,
      later,
    );
    expect(removed).toMatchObject({ entry: null });
    // Deleting again succeeds (AC9); put one back so the cascade below has a row to remove.
    await store.writeWeight(
      id,
      { localDate: TODAY, recentFrom: TODAY, entry: null },
      () => null,
      later,
    );
    await store.writeWeight(
      id,
      {
        localDate: TODAY,
        recentFrom: TODAY,
        entry: { weightKg: 70, recordedAt: later.toISOString() },
      },
      () => null,
      later,
    );

    // Spec 005: the food log on the real SQL (needs the imported catalog: pnpm --filter @pt/db import:foods).
    const catalog = await store.listCatalog();
    expect(catalog.length).toBeGreaterThan(500);
    const egg = catalog.find((f) => f.servings.length > 0)!;
    const itemId = crypto.randomUUID();
    const item = {
      id: itemId,
      localDate: TODAY,
      mealType: 'breakfast' as const,
      foodId: egg.id,
      servingId: egg.servings[0]!.id,
      servings: 2,
      servingLabel: egg.servings[0]!.labelEs,
      grams: egg.servings[0]!.grams * 2,
      unit: 'g' as const,
      label: egg.nameEs,
      nutrients: { kcal: 150.25, proteinG: 12.5, carbsG: 1, fatG: 10, fiberG: null },
      inputMethod: 'search' as const,
      recordedAt: now.toISOString(),
    };
    expect(await store.upsertMealItem(id, item)).toEqual(item);
    // AC20: an older write loses; a delete leaves a tombstone that an older write cannot undo.
    const older = new Date(now.getTime() - 60_000).toISOString();
    expect(
      await store.upsertMealItem(id, { ...item, mealType: 'lunch', recordedAt: older }),
    ).toEqual(item);
    await store.deleteMealItem(id, itemId, later.toISOString());
    expect(await store.listMealItems(id, TODAY, TODAY)).toEqual([]);
    expect(await store.upsertMealItem(id, item)).toBeNull();
    const again = { ...item, id: crypto.randomUUID(), recordedAt: later.toISOString() };
    await store.upsertMealItem(id, again);
    expect(await store.countMealItems(id, TODAY)).toBe(1);
    expect((await store.listRecentFoodItems(id, TODAY, 20)).map((i) => i.id)).toEqual([again.id]);
    await store.setFavouriteFood(id, egg.id, true, now);
    await store.setFavouriteFood(id, egg.id, true, now);
    expect(await store.listFavouriteFoodIds(id)).toEqual([egg.id]);
    const withFood = await store.exportUser(id);
    expect(withFood.mealItems.map((i) => i.id)).toEqual([again.id]);
    expect(withFood.favouriteFoods).toEqual([
      { foodId: egg.id, key: egg.key, createdAt: now.toISOString() },
    ]);

    // Spec 006: a custom food and a scanned product on the real SQL (needs the `open-food-facts` and
    // `user` rows of knowledge_sources: pnpm --filter @pt/db import:foods).
    const foodId = crypto.randomUUID();
    const servingId = crypto.randomUUID();
    const custom = {
      name: 'Yogur AC22',
      brand: 'Prueba',
      unit: 'g' as const,
      per100g: { kcal: 61, proteinG: 3.5, carbsG: 4.7, fatG: 3.1, fiberG: null },
      serving: { id: servingId, label: '1 tarrina', grams: 125 },
      barcode: '96385074',
      origin: 'manual' as const,
    };
    expect(await store.upsertCustomFood(id, foodId, custom, now)).toMatchObject({
      id: foodId,
      ownerId: id,
      origin: 'manual',
      servings: [{ id: servingId, labelEs: '1 tarrina', grams: 125 }],
    });
    // Idempotent; a second food cannot take the barcode; another user's id is refused.
    expect(
      await store.upsertCustomFood(id, foodId, { ...custom, serving: null }, later),
    ).toMatchObject({ id: foodId, servings: [] });
    expect(await store.upsertCustomFood(id, crypto.randomUUID(), custom, now)).toBe(
      'barcode_taken',
    );
    expect(await store.upsertCustomFood(id, egg.id, custom, now)).toBe('not_owner');
    expect((await store.findFoodsByBarcode(id, '96385074')).own?.id).toBe(foodId);
    expect((await store.listCustomFoods(id)).map((f) => f.id)).toEqual([foodId]);
    expect((await store.getFoods(id, [foodId, egg.id])).map((f) => f.id).sort()).toEqual(
      [foodId, egg.id].sort(),
    );
    // Another user cannot read it (AC13).
    expect(await store.getFoods(crypto.randomUUID(), [foodId])).toEqual([]);
    expect((await store.exportUser(id)).customFoods.map((f) => f.id)).toEqual([foodId]);
    expect(await store.countAiUsage(id, 'label_scan', new Date(0))).toBe(1);

    const productBarcode = '73513537';
    await store.recordBarcodeMiss(productBarcode, 'not_found', now);
    expect(await store.getBarcodeMiss(productBarcode, new Date(now.getTime() - 1000))).toBe(
      'not_found',
    );
    expect(await store.getBarcodeMiss(productBarcode, later)).toBeNull();
    const product = await store.saveProduct(
      {
        barcode: productBarcode,
        name: 'Producto AC22',
        brand: null,
        unit: 'ml',
        per100g: { kcal: 42, proteinG: 0, carbsG: 10.6, fatG: 0, fiberG: null },
        servings: [{ labelEs: '1 ración', labelEn: '1 serving', grams: 330 }],
        allergens: ['en:milk'],
        traces: [],
      },
      now,
    );
    try {
      expect(product).toMatchObject({
        origin: 'off',
        unit: 'ml',
        ownerId: null,
        barcode: productBarcode,
      });
      // Saving the product forgets its miss; saving it again keeps its id and its serving.
      expect(await store.getBarcodeMiss(productBarcode, new Date(0))).toBeNull();
      const refreshed = await store.saveProduct(
        {
          barcode: productBarcode,
          name: 'Producto AC22',
          brand: null,
          unit: 'ml',
          per100g: { kcal: 43, proteinG: 0, carbsG: 10.6, fatG: 0, fiberG: null },
          servings: [{ labelEs: '1 ración', labelEn: '1 serving', grams: 330 }],
          allergens: [],
          traces: [],
        },
        later,
      );
      expect(refreshed.id).toBe(product.id);
      expect(refreshed.servings[0]!.id).toBe(product.servings[0]!.id);
      expect((await store.findFoodsByBarcode(id, productBarcode)).product?.per100g.kcal).toBe(43);
      const logged = {
        ...again,
        id: crypto.randomUUID(),
        foodId: product.id,
        servingId: null,
        unit: 'ml' as const,
      };
      expect(await store.upsertMealItem(id, logged)).toMatchObject({ unit: 'ml' });
      expect((await store.listLoggedProducts(id, 10)).map((f) => f.id)).toEqual([product.id]);
      // The catalog cache never holds products or own foods.
      expect((await store.listCatalog()).some((f) => f.id === product.id || f.id === foodId)).toBe(
        false,
      );
    } finally {
      await db.delete(schema.foods).where(eq(schema.foods.id, product.id));
    }

    // Spec 009: custom exercises and the workout log, with the write rules of AC23.
    const exerciseId = crypto.randomUUID();
    const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();
    const press = await store.upsertCustomExercise(id, exerciseId, {
      name: 'Press AC25',
      tracking: 'weight_reps',
      primaryMuscle: 'chest',
      recordedAt: iso(0),
    });
    expect(press).toMatchObject({ id: exerciseId, origin: 'user', category: 'strength' });
    expect((await store.listCustomExercises(id)).map((e) => e.id)).toEqual([exerciseId]);
    const workoutId = crypto.randomUUID();
    const set = (setNumber: number, weightKg: number) => ({
      reps: 8,
      weightKg,
      durationS: null,
      distanceM: null,
      restS: 90,
      setNumber,
    });
    const session = {
      id: workoutId,
      localDate: TODAY,
      kind: 'gym' as const,
      activity: null,
      name: 'Pecho',
      startedAt: iso(-3_600_000),
      minutes: 55,
      sessionRpe: 7,
      inputMethod: 'live' as const,
      programSessionId: null,
      exercises: [
        {
          exerciseId,
          label: 'Press AC25',
          tracking: 'weight_reps' as const,
          sets: [set(1, 60), set(2, 62.5)],
        },
      ],
      recordedAt: iso(1000),
    };
    expect(await store.upsertWorkout(id, session)).toMatchObject({
      id: workoutId,
      exercises: [{ sets: [{ weightKg: 60 }, { weightKg: 62.5 }] }],
    });
    // A `PUT` replaces the sets; an older one changes nothing.
    const edited = { ...session, recordedAt: iso(2000) };
    edited.exercises = [{ ...session.exercises[0]!, sets: [set(1, 70)] }];
    expect((await store.upsertWorkout(id, edited))?.exercises[0]?.sets).toEqual([set(1, 70)]);
    expect((await store.upsertWorkout(id, session))?.exercises[0]?.sets).toEqual([set(1, 70)]);
    expect(await store.listWorkoutIdsOfDay(id, TODAY)).toEqual([workoutId]);
    const rows = await store.listExerciseSetRows(id, exerciseId);
    expect(rows.map((r) => r.set.weightKg)).toEqual([70]);
    // A deleted custom exercise stays loggable and keeps the sets pointing at it.
    await store.deleteCustomExercise(id, exerciseId, iso(3000));
    expect(await store.listCustomExercises(id)).toEqual([]);
    expect((await store.getLoggableExercises(id, [exerciseId])).map((e) => e.id)).toEqual([
      exerciseId,
    ]);
    const exportedTraining = await store.exportUser(id);
    expect(exportedTraining.workouts.map((w) => w.id)).toEqual([workoutId]);
    expect(exportedTraining.customExercises[0]?.deletedAt).not.toBeNull();
    // A tombstone: an earlier write does not bring the workout back.
    await store.deleteWorkout(id, workoutId, iso(4000));
    expect(await store.upsertWorkout(id, { ...edited, recordedAt: iso(3500) })).toBeNull();
    expect(await store.listWorkouts(id, TODAY, TODAY)).toEqual([]);
    expect(await store.listExerciseSetRows(id)).toEqual([]);
    // A later write brings the custom exercise back; another user can never write that id.
    const revived = {
      name: 'Press AC25 bis',
      tracking: 'weight_reps' as const,
      primaryMuscle: null,
      recordedAt: iso(5000),
    };
    expect(await store.upsertCustomExercise(id, exerciseId, revived)).toMatchObject({
      nameEs: 'Press AC25 bis',
    });
    expect(await store.upsertCustomExercise(crypto.randomUUID(), exerciseId, revived)).toBe(
      'id_taken',
    );
    // Another user's write to this workout id changes nothing.
    const otherWorkout = await store.upsertWorkout(crypto.randomUUID(), {
      ...edited,
      recordedAt: iso(9000),
    });
    expect(otherWorkout).toBeNull();
    // Re-add rows so the cascade below covers every training table.
    expect(await store.upsertWorkout(id, { ...edited, recordedAt: iso(6000) })).not.toBeNull();

    // Spec 010: the typical week, stored in one write with the activity days (AC4).
    const football = {
      kind: 'sport' as const,
      label: 'fútbol',
      sessionsPerWeek: 2,
      minutesPerSession: 90,
      intensity: 'moderate' as const,
      days: [
        { weekday: 2, startMinute: 1170, isMatch: false },
        { weekday: 6, startMinute: 660, isMatch: true },
      ],
    };
    const nightShift = [{ weekday: 1, startMinute: 1320, endMinute: 360 }];
    const targetsBefore = (await store.getMe(id)).targets;
    expect(
      await store.saveWeek(
        id,
        {
          week: { workPattern: 'fixed', workBlocks: nightShift, dayStartMinute: 240 },
          plannedActivities: [football],
        },
        now,
      ),
    ).toBe(true);
    expect(
      await store.saveTrainingProfile(id, { experience: 'beginner', equipment: 'full_gym' }, now),
    ).toBe(true);
    const withWeek = (await store.getMe(id)).profile;
    expect(withWeek?.week).toEqual({
      workPattern: 'fixed',
      workBlocks: nightShift,
      dayStartMinute: 240,
    });
    expect(withWeek?.plannedActivities).toEqual([football]);
    expect(withWeek).toMatchObject({ trainingExperience: 'beginner', equipmentAccess: 'full_gym' });
    // Without an evaluation (same training load) the targets row is untouched.
    expect((await store.getMe(id)).targets).toEqual(targetsBefore);

    // Spec 010: the routine, its sessions kept by id and the rotation link of a workout (AC22).
    const programId = crypto.randomUUID();
    const [sessionA, sessionB] = [crypto.randomUUID(), crypto.randomUUID()];
    const target = (sets: number) => ({
      exerciseId,
      label: 'Press AC25 bis',
      tracking: 'weight_reps' as const,
      sets,
      repsMin: 8,
      repsMax: 12,
      durationS: null,
      restS: 120,
    });
    const program = {
      id: programId,
      name: 'Rutina AC24',
      origin: 'template' as const,
      templateKey: 'full-body-ab',
      sessions: [
        { id: sessionA, name: 'Rutina A', exercises: [target(3)] },
        { id: sessionB, name: 'Rutina B', exercises: [target(2)] },
      ],
      recordedAt: iso(7000),
    };
    expect(await store.upsertProgram(id, program)).toEqual(program);
    expect(await store.getProgram(id)).toEqual(program);
    expect(await store.upsertProgram(id, { ...program, id: crypto.randomUUID() })).toBe('id_taken');
    expect(await store.programSessionOwner(id, sessionB)).toBe('own');
    expect(await store.programSessionOwner(crypto.randomUUID(), sessionB)).toBe('other');
    const fromB = {
      ...edited,
      id: crypto.randomUUID(),
      programSessionId: sessionB,
      recordedAt: iso(7100),
    };
    expect((await store.upsertWorkout(id, fromB))?.programSessionId).toBe(sessionB);
    // Session B left out: the workout keeps its sets and loses the link.
    const onlyA = { ...program, sessions: [program.sessions[0]!], recordedAt: iso(7200) };
    expect(await store.upsertProgram(id, onlyA)).toEqual(onlyA);
    expect(await store.programSessionOwner(id, sessionB)).toBe('missing');
    const unlinked = (await store.listWorkouts(id, TODAY, TODAY)).find((w) => w.id === fromB.id);
    expect(unlinked).toMatchObject({ programSessionId: null, exercises: [{ sets: [set(1, 70)] }] });
    // An older write changes nothing; a delete is a tombstone that an older write cannot undo.
    expect(
      await store.upsertProgram(id, { ...program, name: 'Vieja', recordedAt: iso(7150) }),
    ).toEqual(onlyA);
    await store.deleteProgram(id, programId, iso(7300));
    expect(await store.getProgram(id)).toBeNull();
    expect(await store.upsertProgram(id, { ...onlyA, recordedAt: iso(7250) })).toBeNull();
    const second = {
      ...onlyA,
      id: crypto.randomUUID(),
      sessions: [{ ...onlyA.sessions[0]!, id: crypto.randomUUID() }],
      recordedAt: iso(7400),
    };
    expect(await store.upsertProgram(id, second)).toEqual(second);
    expect(await store.upsertProgram(id, { ...onlyA, recordedAt: iso(7500) })).toBe(
      'program_exists',
    );
    const exportedPrograms = (await store.exportUser(id)).programs;
    expect(exportedPrograms.map((p) => [p.id, p.deletedAt !== null])).toEqual([
      [programId, true],
      [second.id, false],
    ]);

    // Spec 011: the daily check-in on the real SQL, with the write rules of AC15.
    const checkin = {
      localDate: TODAY,
      sleepMinutes: 330,
      stress: 'high' as const,
      workShift: 'night' as const,
      shiftStartMinute: 1320,
      shiftEndMinute: 360,
      source: 'manual' as const,
      recordedAt: iso(8000),
    };
    expect(await store.upsertCheckin(id, checkin)).toEqual(checkin);
    expect(
      await store.upsertCheckin(id, { ...checkin, sleepMinutes: 510, recordedAt: iso(7900) }),
    ).toEqual(checkin);
    expect(await store.deleteCheckin(id, TODAY, iso(8100))).toBeNull();
    expect(await store.upsertCheckin(id, { ...checkin, recordedAt: iso(8050) })).toBeNull();
    // A delete with no row stores a tombstone; a newer delete moves it forward.
    const yesterday = addDays(TODAY, -1);
    expect(await store.deleteCheckin(id, yesterday, iso(8100))).toBeNull();
    expect(await store.deleteCheckin(id, yesterday, iso(8300))).toBeNull();
    expect(
      await store.upsertCheckin(id, { ...checkin, localDate: yesterday, recordedAt: iso(8200) }),
    ).toBeNull();
    const dayOff = {
      ...checkin,
      workShift: 'off' as const,
      shiftStartMinute: null,
      shiftEndMinute: null,
      recordedAt: iso(8400),
    };
    expect(await store.upsertCheckin(id, dayOff)).toEqual(dayOff);
    expect(await store.listCheckins(id, yesterday, TODAY)).toEqual([dayOff]);
    expect(
      (await store.exportUser(id)).checkins.map((c) => [c.localDate, c.deletedAt !== null]),
    ).toEqual([
      [yesterday, true],
      [TODAY, false],
    ]);

    // Spec 002 AC16: the list of user tables comes from the database, so a new table with a user
    // column that is not covered below fails this test.
    const userTables = await db.execute<{ table_name: string; column_name: string }>(sql`
      select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and (c.column_name in ('user_id', 'owner_id')
          or (c.table_name = 'profiles' and c.column_name = 'id'))
      order by c.table_name`);
    expect(userTables.map((t) => t.table_name)).toEqual([...COVERED_USER_TABLES].sort());

    await createSupabaseAuthAdmin({ supabaseUrl: base, serviceRoleKey: key }).deleteUser(id);
    userId = null;

    const [authUser] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from auth.users where id = ${id}`,
    );
    expect(authUser?.n).toBe(0);
    for (const { table_name, column_name } of userTables) {
      const [left] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table_name)} where ${sql.identifier(column_name)} = ${id}`,
      );
      expect(left?.n, `rows left in ${table_name}`).toBe(0);
    }

    const [kept] = await db
      .select({ userId: schema.aiUsage.userId })
      .from(schema.aiUsage)
      .where(eq(schema.aiUsage.id, (usageRow as { id: string }).id));
    expect(kept).toEqual({ userId: null });
    await db.delete(schema.aiUsage).where(eq(schema.aiUsage.id, (usageRow as { id: string }).id));
  }, 60_000); // About 30 s on the dev pooler since spec 011.
});
