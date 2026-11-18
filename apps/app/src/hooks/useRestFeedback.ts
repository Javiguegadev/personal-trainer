import restDone from '@/assets/sounds/rest-done.wav';
import { useAudioPlayer } from 'expo-audio';
import { NotificationFeedbackType, notificationAsync } from 'expo-haptics';
import { useCallback } from 'react';

/**
 * The end of the rest timer (spec 009 AC9): a haptic and a short chime while the app is in the
 * foreground. Either may be unavailable (haptics on web, audio blocked by the browser): the timer and
 * its message still show.
 */
export function useRestFeedback(): () => void {
  const player = useAudioPlayer(restDone);
  return useCallback(() => {
    notificationAsync(NotificationFeedbackType.Success).catch(() => undefined);
    try {
      void player.seekTo(0);
      player.play();
    } catch {
      // No sound: the haptic and the text are enough.
    }
  }, [player]);
}
