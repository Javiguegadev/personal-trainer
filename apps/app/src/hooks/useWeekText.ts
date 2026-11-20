import type { ActivityKind, Weekday, WorkBlock } from '@pt/contracts';
import { formatMinuteOfDay, type PlannedSlot } from '@pt/core';
import type { WeekdayKey } from '@/components/WeekdayChips';
import { useI18n } from './useI18n';

/** How the typical week is written (spec 010 AC5, AC8): day names, activity names, times. */
export function useWeekText() {
  const { t, locale } = useI18n();
  const w = t.week;
  const time = (minute: number) => formatMinuteOfDay(minute, locale);
  const name = (kind: ActivityKind, label: string | null) => label ?? w.kindName[kind];

  return {
    time,
    /** "lunes" / "Monday". */
    day: (weekday: Weekday) => w.weekdayLong[weekday as WeekdayKey],
    /** The name the user gave, or the kind ("Gimnasio"). */
    activityName: name,
    /** The name inside a sentence ("tu gimnasio del lunes"). */
    activityNoun: (kind: ActivityKind, label: string | null) => label ?? w.kindNoun[kind],
    /** "08:00–16:00". */
    work: (block: Pick<WorkBlock, 'startMinute' | 'endMinute'>) =>
      `${time(block.startMinute)}–${time(block.endMinute)}`,
    /** "Gimnasio 18:30", "Fútbol · partido 11:00", "Cardio". */
    slot: (slot: PlannedSlot) =>
      [
        slot.isMatch
          ? `${name(slot.kind, slot.label)} · ${w.match.toLocaleLowerCase(locale)}`
          : name(slot.kind, slot.label),
        slot.startMinute === null ? null : time(slot.startMinute),
      ]
        .filter(Boolean)
        .join(' '),
  };
}
