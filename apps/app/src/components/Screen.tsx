import { tokens } from '@pt/ui';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { DemoBanner } from './DemoBanner';

interface ScreenProps {
  children: ReactNode;
  /** Fixed area under the content (primary actions, chat composer). */
  footer?: ReactNode;
  /** Scrollable content (default). Use false for screens that manage their own list, like the chat. */
  scroll?: boolean;
  testID?: string;
}

/**
 * Screen frame: safe areas, theme background, keyboard avoidance (edge-to-edge Android needs an explicit
 * `behavior`), and a capped content width on web/tablets.
 */
export function Screen({ children, footer, scroll = true, testID }: ScreenProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} testID={testID}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <DemoBanner />
        {scroll ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.content, styles.flex]}>{children}</View>
        )}
        {footer ? (
          <View
            style={[
              styles.footer,
              { borderTopColor: colors.border, backgroundColor: colors.background },
            ]}
          >
            <View style={styles.footerInner}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: {
    gap: tokens.space.md,
    padding: tokens.space.lg,
    width: '100%',
    maxWidth: tokens.layout.maxContentWidth,
    alignSelf: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
  },
  footerInner: {
    gap: tokens.space.sm,
    width: '100%',
    maxWidth: tokens.layout.maxContentWidth,
    alignSelf: 'center',
  },
});
