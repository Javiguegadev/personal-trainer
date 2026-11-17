import { tokens } from '@pt/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

/** A titled surface for one block of a screen. */
export function Card({
  title,
  aside,
  children,
  testID,
}: {
  title: string;
  /** Shown at the right of the title (a badge, a spinner). */
  aside?: ReactNode;
  children: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID={testID}
    >
      <View style={styles.header}>
        <AppText variant="subtitle" weight="bold" accessibilityRole="header">
          {title}
        </AppText>
        {aside}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.md,
    gap: tokens.space.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.space.sm,
    flexWrap: 'wrap',
  },
});
