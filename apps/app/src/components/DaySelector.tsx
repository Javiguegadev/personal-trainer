import { addDays, formatShortDate, formatWeekdayDay } from '@pt/core';
import { useI18n } from '@/hooks/useI18n';
import { ChoiceGroup } from './ChoiceGroup';

interface DaySelectorProps {
  label: string;
  /** The days offered, newest first (`YYYY-MM-DD`). */
  days: readonly string[];
  today: string;
  value: string;
  onChange: (day: string) => void;
  /** `scroll` keeps the chips in one row (the Food tab); `chips` wraps them (the weight sheet). */
  layout?: 'chips' | 'scroll';
  error?: string | null;
  testID?: string;
}

/** How a day is named: "Hoy", "Ayer", then "vie 13"; a day older than a week shows its date. */
export function useDayLabel(today: string): (day: string) => string {
  const { t, locale } = useI18n();
  return (day) => {
    if (day === today) return t.weight.sheet.today;
    if (day === addDays(today, -1)) return t.weight.sheet.yesterday;
    if (day < addDays(today, -6)) {
      return formatShortDate(day, locale, day.slice(0, 4) !== today.slice(0, 4));
    }
    return formatWeekdayDay(day, locale);
  };
}

/** Day chips, named by `useDayLabel`. */
export function DaySelector({
  label,
  days,
  today,
  value,
  onChange,
  layout = 'chips',
  error,
  testID,
}: DaySelectorProps) {
  const dayLabel = useDayLabel(today);
  return (
    <ChoiceGroup
      label={label}
      options={days.map((day) => ({ value: day, label: dayLabel(day) }))}
      value={value}
      onChange={onChange}
      layout={layout}
      error={error}
      testID={testID}
    />
  );
}
