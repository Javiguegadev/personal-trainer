import { isApiError } from '@pt/api-client';
import { ONBOARDING_LIMITS, type ChatMessage } from '@pt/contracts';
import { missingDraftFields, trimTranscript } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ChatBubble } from '@/components/ChatBubble';
import { DraftChips } from '@/components/DraftChips';
import { Notice } from '@/components/Notice';
import { SafetyNotices } from '@/components/SafetyNotices';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useOnboardingChat } from '@/lib/api';

/**
 * Conversational onboarding (AC8): the AI fills the draft and asks only for what is missing. Keyboard
 * dictation works in the text field. "Use a form instead" is always available (AC11), and the form is
 * the way out when the AI is down or the daily cap is reached (AC12).
 */
export default function OnboardingChatScreen() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const { messages, draft, softStop, form, setChat, formFromDraft } = useOnboarding();
  const chat = useOnboardingChat();
  const [text, setText] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);
  const c = t.onboarding.chat;

  const complete = missingDraftFields(draft).length === 0;
  const rateLimited = isApiError(chat.error, 'rate_limited');
  const failed = chat.isError && !rateLimited;

  function ask(transcript: ChatMessage[]) {
    chat.mutate(
      {
        messages: trimTranscript(transcript, ONBOARDING_LIMITS.messagesPerRequest),
        draft,
        locale,
        today,
      },
      {
        onSuccess: (response) =>
          setChat({
            messages: [...transcript, { role: 'assistant', content: response.reply }],
            draft: response.draft,
            softStop: softStop || response.softStop,
          }),
      },
    );
  }

  function send() {
    const content = text.trim();
    if (!content || chat.isPending || rateLimited) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content }];
    setChat({ messages: next, draft, softStop });
    setText('');
    ask(next);
  }

  function open(route: '/onboarding/form' | '/onboarding/summary') {
    formFromDraft();
    router.push(route);
  }

  return (
    <Screen
      scroll={false}
      testID="onboarding-chat-screen"
      footer={
        <>
          {softStop ? (
            <Button
              label={c.continueMaintenance}
              onPress={() => open('/onboarding/summary')}
              testID="continue-maintenance"
            />
          ) : complete ? (
            <Button
              label={c.review}
              onPress={() => open('/onboarding/summary')}
              testID="review-summary"
            />
          ) : null}
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel={c.inputLabel}
              placeholder={c.placeholder}
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={setText}
              onSubmitEditing={send}
              returnKeyType="send"
              submitBehavior="submit"
              editable={!rateLimited}
              maxLength={ONBOARDING_LIMITS.messageChars}
              style={[
                styles.input,
                { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              testID="chat-input"
            />
            <Button
              label={c.send}
              onPress={send}
              loading={chat.isPending}
              disabled={!text.trim() || chat.isPending || rateLimited}
              testID="chat-send"
            />
          </View>
        </>
      }
    >
      <View style={styles.header}>
        <AppText variant="title" style={styles.title}>
          {c.title}
        </AppText>
        <Button
          variant="secondary"
          label={c.useForm}
          onPress={() => open('/onboarding/form')}
          testID="use-form"
        />
      </View>
      <DraftChips draft={draft} units={form.units} today={today} />

      <ScrollView
        ref={scroll}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        <ChatBubble role="assistant" content={c.intro} />
        {messages.map((message, index) => (
          <ChatBubble key={index} role={message.role} content={message.content} />
        ))}
        {chat.isPending ? (
          <AppText
            tone="muted"
            variant="label"
            accessibilityLiveRegion="polite"
            testID="chat-typing"
          >
            {c.typing}
          </AppText>
        ) : null}
        {softStop ? <SafetyNotices notices={['ed_soft_stop']} /> : null}
        {rateLimited ? (
          <Notice tone="warning" message={c.rateLimited} testID="chat-rate-limited">
            <Button label={c.useForm} onPress={() => open('/onboarding/form')} />
          </Notice>
        ) : failed ? (
          <Notice tone="danger" message={c.aiUnavailable} testID="chat-error">
            <Button variant="secondary" label={c.retry} onPress={() => ask(messages)} />
            <Button label={c.useForm} onPress={() => open('/onboarding/form')} />
          </Notice>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: tokens.space.sm,
  },
  title: { flexShrink: 1 },
  messages: { flex: 1 },
  messagesContent: { gap: tokens.space.sm, paddingVertical: tokens.space.sm },
  composer: { flexDirection: 'row', gap: tokens.space.sm, alignItems: 'flex-end' },
  input: {
    flex: 1,
    minHeight: tokens.layout.minTouchTarget,
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    fontSize: tokens.fontSize.body,
  },
});
