import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

/** One chat message. The author is announced to screen readers, not shown only by side and color. */
export function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const mine = role === 'user';
  return (
    <View
      style={[
        styles.bubble,
        mine
          ? [styles.mine, { backgroundColor: colors.primary }]
          : [styles.theirs, { backgroundColor: colors.surface, borderColor: colors.border }],
      ]}
      accessibilityLabel={`${mine ? t.onboarding.chat.you : t.onboarding.chat.assistant}: ${content}`}
      testID={mine ? 'chat-user' : 'chat-assistant'}
    >
      <AppText style={mine ? { color: colors.onPrimary } : undefined}>{content}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '88%',
    borderRadius: tokens.radius.lg,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: tokens.radius.sm },
  theirs: { alignSelf: 'flex-start', borderWidth: 1, borderBottomLeftRadius: tokens.radius.sm },
});
