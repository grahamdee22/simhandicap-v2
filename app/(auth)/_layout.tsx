import { Stack } from 'expo-router';
import { colors } from '@/src/lib/constants';
import { useTranslation } from '@/src/i18n';

export default function AuthLayout() {
  const { t } = useTranslation();

  return (
    <Stack
      initialRouteName="index"
      screenOptions={{
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600', fontSize: 15 },
        contentStyle: { flex: 1, backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ title: t('common.createAccount') }} />
      <Stack.Screen
        name="complete-oauth-profile"
        options={{ title: t('auth.completeProfile.navTitle') }}
      />
      <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="reset-password" options={{ headerShown: false }} />
    </Stack>
  );
}
