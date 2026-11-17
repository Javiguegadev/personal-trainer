import { isApiError } from '@pt/api-client';
import {
  CUSTOM_FOOD_LIMITS,
  type CustomFoodUpsertRequest,
  type Food,
  type LabelImage,
  type LabelUnreadableReason,
} from '@pt/contracts';
import {
  EMPTY_CUSTOM_FOOD_FIELDS,
  customFoodEnergyMismatch,
  customFoodFields,
  customFoodFieldsFromDraft,
  parseCustomFoodFields,
  type CustomFoodField,
  type CustomFoodFieldErrors,
  type CustomFoodFields,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { useTheme } from '@/hooks/useTheme';
import { useScanLabel } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { newId } from '@/lib/id';
import { pickPhoto } from '@/lib/photo';
import { AppText } from './AppText';
import { Button } from './Button';
import { ChoiceGroup } from './ChoiceGroup';
import { Notice } from './Notice';
import { Screen } from './Screen';
import { TextField } from './TextField';

interface CustomFoodFormProps {
  /** The food being edited (spec 006 AC12); a new food when omitted. */
  food?: Food;
  /** The barcode a scan brought (AC6): shown read-only and stored with the food. */
  barcode?: string | null;
  /** The search that found nothing, as the name to start from. */
  initialName?: string;
  /** A label photo already taken ("Leer la etiqueta con una foto" of AC6): it is read at once. */
  initialImage?: LabelImage;
  /**
   * False with an eating-disorder signal (spec 005 AC18): the form keeps the numbers the user types,
   * but the app does not put numbers in front of them, so the label photo is not offered.
   */
  showNumbers: boolean;
  onSubmit: (request: CustomFoodUpsertRequest) => void;
  onCancel: () => void;
}

type LabelState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'done' }
  | { kind: 'unreadable'; reason: LabelUnreadableReason }
  | { kind: 'failed'; message: string };

/** The four values a food cannot be saved without: marked when a photo did not give them. */
const REQUIRED: CustomFoodField[] = ['kcal', 'protein', 'carbs', 'fat'];

/**
 * "Crear alimento" (spec 006 AC9, AC10): the values of a label typed by hand, for a product the app
 * does not know. A photo of the label is a shortcut that fills the same fields (AC14–AC17): every
 * value it read is marked, the ones it could not read stay empty, and nothing is saved until the user
 * taps "Guardar".
 */
export function CustomFoodForm({
  food,
  barcode = null,
  initialName = '',
  initialImage,
  showNumbers,
  onSubmit,
  onCancel,
}: CustomFoodFormProps) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const scan = useScanLabel();
  const c = t.food.custom;
  const l = t.food.label;
  const [fields, setFields] = useState<CustomFoodFields>(() =>
    food
      ? customFoodFields(food, locale)
      : { ...EMPTY_CUSTOM_FOOD_FIELDS, name: initialName.slice(0, CUSTOM_FOOD_LIMITS.nameMax) },
  );
  const [errors, setErrors] = useState<CustomFoodFieldErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [label, setLabel] = useState<LabelState>({ kind: 'idle' });
  /** The fields the last photo filled, until the user edits them. */
  const [read, setRead] = useState<CustomFoodField[]>([]);
  const [fromLabel, setFromLabel] = useState(false);
  // The id of the serving is the food's current one, so logged items keep pointing to it.
  const [servingId] = useState(() => food?.servings[0]?.id ?? newId());
  const formErrors: Record<string, string> = t.onboarding.form.errors;

  const readLabel = (image: LabelImage) => {
    setLabel({ kind: 'reading' });
    scan.mutate(
      { image, locale },
      {
        onSuccess: (result) => {
          if (result.status === 'unreadable') {
            return setLabel({ kind: 'unreadable', reason: result.reason });
          }
          // Which fields the photo filled depends only on the draft; their values go on top of what
          // the user has typed by now (the form stays usable while the photo is read).
          setRead(customFoodFieldsFromDraft(result.draft, EMPTY_CUSTOM_FOOD_FIELDS, locale).read);
          setFields((current) => customFoodFieldsFromDraft(result.draft, current, locale).fields);
          setErrors({});
          setConfirming(false);
          setFromLabel(true);
          setLabel({ kind: 'done' });
        },
        onError: (error) => {
          const message = isApiError(error, 'ai_unavailable') ? l.failed : errorMessage(error, t);
          setLabel({ kind: 'failed', message });
        },
      },
    );
  };

  // A photo taken on the screen before this one is read once, also when React mounts twice in dev:
  // every read is a metered call.
  const started = useRef(false);
  useEffect(() => {
    if (!initialImage || !showNumbers || started.current) return;
    started.current = true;
    readLabel(initialImage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, for the photo the form opened with
  }, []);

  const takePhoto = async (source: 'camera' | 'library') => {
    try {
      const photo = await pickPhoto(source);
      if (photo.status === 'denied') return setLabel({ kind: 'failed', message: l.permission });
      if (photo.status === 'ok') readLabel(photo.image);
    } catch {
      setLabel({ kind: 'failed', message: l.failed });
    }
  };

  const edit = (field: CustomFoodField) => (text: string) => {
    setFields({ ...fields, [field]: text });
    setErrors({ ...errors, [field]: undefined, macros: undefined });
    setRead(read.filter((name) => name !== field));
    setConfirming(false);
  };
  const errorOf = (field: CustomFoodField) => {
    const code = errors[field];
    return code ? (formErrors[code] ?? t.errors.validation_error) : null;
  };
  /** Under a field: that the photo filled it, or that the photo did not show a required value. */
  const hintOf = (field: CustomFoodField) => {
    if (read.includes(field)) return l.readField;
    if (label.kind === 'done' && REQUIRED.includes(field) && fields[field].trim() === '') {
      return l.missingField;
    }
    return undefined;
  };

  const submit = (confirmed: boolean) => {
    const parsed = parseCustomFoodFields(fields, {
      barcode: food ? food.barcode : barcode,
      // A food keeps how it was made; a photo that fills the form makes it a label food.
      origin: fromLabel || food?.origin === 'label' ? 'label' : 'manual',
      servingId,
      defaultServingLabel: c.defaultServing,
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    // Often a typing mistake in the calories or in a macro (AC10).
    if (!confirmed && customFoodEnergyMismatch(parsed.request.per100g)) return setConfirming(true);
    onSubmit(parsed.request);
  };

  const number = { keyboardType: 'decimal-pad', inputMode: 'decimal' } as const;
  const field = (name: CustomFoodField, labelText: string, testID: string) => (
    <TextField
      label={labelText}
      value={fields[name]}
      onChangeText={edit(name)}
      error={errorOf(name)}
      hint={hintOf(name)}
      {...number}
      testID={testID}
    />
  );
  const shownBarcode = food ? food.barcode : barcode;
  const reading = label.kind === 'reading';

  return (
    <Screen
      testID="custom-food-form"
      footer={
        <>
          {errors.macros ? (
            <Notice tone="danger" message={c.macrosTooHigh} testID="custom-food-macros" />
          ) : null}
          {confirming ? (
            <Notice
              tone="warning"
              title={c.confirmTitle}
              message={c.confirmMessage}
              testID="custom-food-confirm"
            >
              <Button
                label={c.confirmYes}
                onPress={() => submit(true)}
                testID="custom-food-confirm-yes"
              />
              <Button variant="ghost" label={c.confirmNo} onPress={() => setConfirming(false)} />
            </Notice>
          ) : (
            <Button label={c.save} onPress={() => submit(false)} testID="custom-food-submit" />
          )}
          <Button
            variant="ghost"
            label={t.food.portion.cancel}
            onPress={onCancel}
            testID="custom-food-cancel"
          />
        </>
      }
    >
      <AppText variant="title">{food ? c.editTitle : c.title}</AppText>
      <AppText tone="muted">{c.text}</AppText>
      {shownBarcode ? (
        <AppText variant="caption" tone="muted" testID="custom-food-barcode">
          {format(c.barcode, { barcode: shownBarcode })}
        </AppText>
      ) : null}

      {showNumbers ? (
        <View
          style={[styles.label, { borderColor: colors.border, backgroundColor: colors.surface }]}
          testID="label-photo"
        >
          <AppText variant="caption" tone="muted">
            {l.hint}
          </AppText>
          {reading ? (
            <View style={styles.reading} role="status" accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.primary} />
              <AppText testID="label-reading">{l.reading}</AppText>
            </View>
          ) : null}
          {label.kind === 'done' ? (
            <Notice tone="success" message={l.done} testID="label-done" />
          ) : null}
          {label.kind === 'unreadable' ? (
            <Notice tone="warning" message={l.unreadable[label.reason]} testID="label-unreadable" />
          ) : null}
          {label.kind === 'failed' ? (
            <Notice tone="warning" message={label.message} testID="label-failed" />
          ) : null}
          {online ? (
            <View style={styles.photoButtons}>
              <Button
                variant="secondary"
                label={label.kind === 'idle' || reading ? l.takePhoto : l.retake}
                onPress={() => void takePhoto('camera')}
                disabled={reading}
                testID="label-take-photo"
              />
              <Button
                variant="ghost"
                label={l.pickImage}
                onPress={() => void takePhoto('library')}
                disabled={reading}
                testID="label-pick-image"
              />
            </View>
          ) : (
            <Notice tone="info" message={l.offline} testID="label-offline" />
          )}
        </View>
      ) : null}

      <TextField
        label={c.name}
        value={fields.name}
        onChangeText={edit('name')}
        error={errorOf('name')}
        hint={hintOf('name')}
        maxLength={CUSTOM_FOOD_LIMITS.nameMax}
        testID="custom-food-name"
      />
      <TextField
        label={c.brand}
        value={fields.brand}
        onChangeText={edit('brand')}
        error={errorOf('brand')}
        hint={hintOf('brand')}
        maxLength={CUSTOM_FOOD_LIMITS.brandMax}
        testID="custom-food-brand"
      />
      <ChoiceGroup
        label={c.basis}
        options={[
          { value: 'g', label: c.per100g },
          { value: 'ml', label: c.per100ml },
        ]}
        value={fields.unit}
        onChange={(unit) => setFields({ ...fields, unit })}
        testID="custom-food-unit"
      />
      {field('kcal', c.kcal, 'custom-food-kcal')}
      {field('protein', c.protein, 'custom-food-protein')}
      {field('carbs', c.carbs, 'custom-food-carbs')}
      {field('fat', c.fat, 'custom-food-fat')}
      {field('fiber', c.fiber, 'custom-food-fiber')}

      <AppText variant="label" accessibilityRole="header">
        {c.servingTitle}
      </AppText>
      {field(
        'servingGrams',
        fields.unit === 'ml' ? c.servingSizeMl : c.servingSizeG,
        'custom-food-serving-size',
      )}
      <TextField
        label={c.servingLabel}
        placeholder={c.defaultServing}
        value={fields.servingLabel}
        onChangeText={edit('servingLabel')}
        error={errorOf('servingLabel')}
        maxLength={CUSTOM_FOOD_LIMITS.servingLabelMax}
        testID="custom-food-serving-label"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.md,
    gap: tokens.space.sm,
  },
  reading: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  photoButtons: { gap: tokens.space.xs },
});
