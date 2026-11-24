import { WEEK_LIMITS } from '@pt/contracts';
import { formatMinuteOfDay, timeOfDayOptions } from '@pt/core';
import { tokens } from '@pt/ui';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { TimeFieldFrame, type TimeFieldProps } from './TimeFieldFrame';

const NONE = 'none';

/** A time of day in a browser (spec 010 AC2): a native `<select>` every `step` minutes. */
export function TimeField(props: TimeFieldProps) {
  const { value, onChange, step = WEEK_LIMITS.timeStep, label, optional, testID } = props;
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  return (
    <TimeFieldFrame {...props} clearable={false}>
      <select
        aria-label={label}
        data-testid={testID ? `${testID}-value` : undefined}
        value={value === null ? NONE : String(value)}
        onChange={(event) =>
          onChange(event.target.value === NONE ? null : Number(event.target.value))
        }
        style={{
          minHeight: tokens.layout.minTouchTarget,
          minWidth: 112,
          borderRadius: tokens.radius.md,
          border: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
          color: colors.text,
          fontSize: tokens.fontSize.body,
          fontWeight: 'bold',
          paddingLeft: tokens.space.sm,
          paddingRight: tokens.space.sm,
        }}
      >
        {optional || value === null ? <option value={NONE}>{t.week.noTime}</option> : null}
        {timeOfDayOptions(step).map((minute) => (
          <option key={minute} value={String(minute)}>
            {formatMinuteOfDay(minute, locale)}
          </option>
        ))}
      </select>
    </TimeFieldFrame>
  );
}
