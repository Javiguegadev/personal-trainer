import { WorkPatternSchema, type WorkBlock, type WorkPattern } from '@pt/contracts';
import {
  blockEndsNextDay,
  copyWorkHours,
  formatMinuteOfDay,
  isValidWorkBlock,
  setWorkHours,
  toggleWorkDay,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Button } from './Button';
import { ChoiceGroup } from './ChoiceGroup';
import { TimeField } from './TimeField';
import { WeekdayChips, type WeekdayKey } from './WeekdayChips';

/** The hours a first work day gets (08:00–16:00); later days copy the first block. */
const DEFAULT_HOURS = { startMinute: 8 * 60, endMinute: 16 * 60 };

interface WorkRowProps {
  pattern: WorkPattern | null;
  blocks: readonly WorkBlock[];
  onPatternChange: (pattern: WorkPattern) => void;
  onBlocksChange: (blocks: WorkBlock[]) => void;
  patternError?: string | null;
}

/**
 * The work row of "Mi semana" (spec 010 AC3): the work pattern, and with fixed hours the work days
 * with a start and end time each. A new day takes the hours of the first one; a day can then be
 * changed alone, and "Copiar a todos" copies one day's hours to the others. An end earlier than the
 * start ends the next day; equal times are an error.
 */
export function WorkRow({
  pattern,
  blocks,
  onPatternChange,
  onBlocksChange,
  patternError,
}: WorkRowProps) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const w = t.week;
  const hoursOfNewDay = blocks[0]
    ? { startMinute: blocks[0].startMinute, endMinute: blocks[0].endMinute }
    : DEFAULT_HOURS;

  return (
    <View style={styles.group} testID="week-work">
      <ChoiceGroup
        label={w.pattern}
        options={WorkPatternSchema.options.map((value) => ({
          value,
          label: w.patternOptions[value],
        }))}
        value={pattern}
        onChange={onPatternChange}
        error={patternError}
        hint={pattern !== null && pattern !== 'fixed' ? w.patternNoBlocks : undefined}
        testID="week-pattern"
      />
      {pattern === 'fixed' ? (
        <>
          <AppText variant="label">{w.workDays}</AppText>
          <WeekdayChips
            label={w.work}
            selected={blocks.map((b) => b.weekday)}
            onToggle={(weekday) => onBlocksChange(toggleWorkDay(blocks, weekday, hoursOfNewDay))}
            testID="week-work-days"
          />
          {blocks.length === 0 ? (
            <AppText variant="caption" tone="muted">
              {w.workDaysEmpty}
            </AppText>
          ) : null}
          {blocks.map((block) => {
            const day = w.weekdayLong[block.weekday as WeekdayKey];
            const id = `week-work-${block.weekday}`;
            const valid = isValidWorkBlock(block);
            return (
              <View
                key={block.weekday}
                style={[styles.day, { borderColor: valid ? colors.border : colors.danger }]}
                testID={id}
              >
                <View style={styles.header}>
                  <AppText weight="bold" accessibilityRole="header" style={styles.name}>
                    {day.charAt(0).toLocaleUpperCase(locale) + day.slice(1)}
                  </AppText>
                  {blocks.length > 1 ? (
                    <Button
                      variant="ghost"
                      label={w.copyToAll}
                      accessibilityLabel={format(w.copyToAllA11y, { day })}
                      onPress={() => onBlocksChange(copyWorkHours(blocks, block.weekday))}
                      testID={`${id}-copy`}
                    />
                  ) : null}
                </View>
                <View style={styles.times}>
                  <TimeField
                    label={w.start}
                    value={block.startMinute}
                    onChange={(minute) =>
                      onBlocksChange(
                        setWorkHours(blocks, block.weekday, {
                          startMinute: minute ?? block.startMinute,
                          endMinute: block.endMinute,
                        }),
                      )
                    }
                    testID={`${id}-start`}
                  />
                  <TimeField
                    label={w.end}
                    value={block.endMinute}
                    onChange={(minute) =>
                      onBlocksChange(
                        setWorkHours(blocks, block.weekday, {
                          startMinute: block.startMinute,
                          endMinute: minute ?? block.endMinute,
                        }),
                      )
                    }
                    error={valid ? null : w.sameTimes}
                    testID={`${id}-end`}
                  />
                </View>
                {valid && blockEndsNextDay(block) ? (
                  <AppText variant="caption" tone="muted" testID={`${id}-next-day`}>
                    {`${formatMinuteOfDay(block.startMinute, locale)}–${formatMinuteOfDay(
                      block.endMinute,
                      locale,
                    )} · ${w.endsNextDay}`}
                  </AppText>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.sm },
  day: {
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    padding: tokens.space.sm,
    gap: tokens.space.xs,
  },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.md },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: tokens.layout.minTouchTarget },
  name: { flex: 1 },
});
