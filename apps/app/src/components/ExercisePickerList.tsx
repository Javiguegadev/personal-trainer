import type { Exercise } from '@pt/contracts';
import { exerciseName } from '@pt/core';
import { tokens } from '@pt/ui';
import type { ReactElement } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

export interface ExerciseSection {
  key: string;
  title: string;
  data: Exercise[];
}

/**
 * Exercises in sections (recents, a muscle group, all, search results) for the picker (spec 009 AC5)
 * and the library. With `selected`, rows are checkboxes (several can be picked in one visit, AC7);
 * without it, a tap opens the exercise.
 */
export function ExercisePickerList({
  sections,
  selected,
  onPress,
  header,
  footer,
  testID,
}: {
  sections: readonly ExerciseSection[];
  selected?: readonly string[];
  onPress: (exercise: Exercise) => void;
  header?: ReactElement;
  footer?: ReactElement;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  return (
    <SectionList
      sections={sections as ExerciseSection[]}
      keyExtractor={(item, index) => `${item.id}-${index}`}
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      contentContainerStyle={styles.content}
      testID={testID}
      renderSectionHeader={({ section }) => (
        <AppText
          variant="label"
          weight="bold"
          tone="muted"
          accessibilityRole="header"
          style={styles.sectionTitle}
        >
          {section.title}
        </AppText>
      )}
      renderItem={({ item }) => {
        const checked = selected?.includes(item.id) ?? false;
        const muscles = item.primaryMuscles.map((m) => t.training.muscles[m]).join(', ');
        return (
          <Pressable
            role={selected ? 'checkbox' : 'button'}
            aria-checked={selected ? checked : undefined}
            accessibilityLabel={exerciseName(item, locale)}
            onPress={() => onPress(item)}
            testID={`exercise-option-${item.key ?? item.id}`}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: checked ? colors.surfaceMuted : colors.surface,
                borderColor: checked ? colors.primary : colors.border,
                borderWidth: checked ? 2 : 1,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={styles.text}>
              <AppText weight={checked ? 'bold' : 'semibold'}>{exerciseName(item, locale)}</AppText>
              {muscles || item.origin === 'user' ? (
                <AppText variant="caption" tone="muted">
                  {[item.origin === 'user' ? t.training.picker.mine : null, muscles || null]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
              ) : null}
            </View>
            {selected ? (
              <View
                style={[
                  styles.check,
                  {
                    borderColor: checked ? colors.primary : colors.border,
                    backgroundColor: checked ? colors.primary : 'transparent',
                  },
                ]}
              >
                {checked ? (
                  <AppText weight="bold" style={{ color: colors.onPrimary }}>
                    ✓
                  </AppText>
                ) : null}
              </View>
            ) : (
              <AppText tone="muted">›</AppText>
            )}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    gap: tokens.space.sm,
    paddingBottom: tokens.space.lg,
  },
  sectionTitle: { marginTop: tokens.space.md },
  row: {
    minHeight: tokens.layout.minTouchTarget,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
  },
  text: { flex: 1, gap: 2 },
  check: {
    width: 28,
    height: 28,
    borderRadius: tokens.radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
