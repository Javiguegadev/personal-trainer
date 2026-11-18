import { useLocalSearchParams, useRouter } from 'expo-router';
import { CustomExerciseForm } from '@/components/CustomExerciseForm';
import { Screen } from '@/components/Screen';

/** "Crear ejercicio" from the library (spec 009 Assumptions): then its page opens. */
export default function NewExerciseRoute() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name?: string }>();
  return (
    <Screen testID="new-exercise-screen">
      <CustomExerciseForm
        initialName={name ?? ''}
        onCreated={(id) => router.replace({ pathname: '/training/exercises/[id]', params: { id } })}
        onCancel={() =>
          router.canGoBack() ? router.back() : router.replace('/training/exercises')
        }
      />
    </Screen>
  );
}
