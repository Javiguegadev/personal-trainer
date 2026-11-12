import { tokens, type Palette } from '@pt/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

type Tone = 'info' | 'warning' | 'danger' | 'success';

const SURFACE: Record<Tone, [keyof Palette, keyof Palette]> = {
  info: ['info', 'infoSurface'],
  warning: ['warning', 'warningSurface'],
  danger: ['danger', 'dangerSurface'],
  success: ['success', 'successSurface'],
};

interface NoticeProps {
  tone: Tone;
  title?: string;
  message?: string;
  children?: ReactNode;
  testID?: string;
}

/** Inline message. Danger and warning notices are announced to screen readers. */
export function Notice({ tone, title, message, children, testID }: NoticeProps) {
  const { colors } = useTheme();
  const [fg, bg] = SURFACE[tone];
  const urgent = tone === 'danger' || tone === 'warning';
  return (
    <View
      testID={testID}
      role={urgent ? 'alert' : undefined}
      accessibilityLiveRegion={urgent ? 'polite' : 'none'}
      style={[styles.notice, { backgroundColor: colors[bg], borderLeftColor: colors[fg] }]}
    >
      {title ? (
        <AppText variant="label" weight="bold" tone={tone}>
          {title}
        </AppText>
      ) : null}
      {message ? (
        <AppText variant="label" weight="regular">
          {message}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderLeftWidth: 4,
    borderRadius: tokens.radius.md,
    padding: tokens.space.md,
    gap: tokens.space.xs,
  },
});
