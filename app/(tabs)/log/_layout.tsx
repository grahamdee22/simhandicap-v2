import { Stack } from 'expo-router';
import { HeaderInstagramAndSimCap } from '../../../src/components/HeaderInstagramSimCap';
import { colors } from '../../../src/lib/constants';

/**
 * Center-tab stack: choice screen → Log a Round or Analyze Practice.
 * Tab chrome (label/icon) stays on `(tabs)/_layout`; titles live here.
 */
export default function LogStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: '#fff',
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        headerTitleStyle: { fontWeight: '700', fontSize: 22 },
        headerRight: HeaderInstagramAndSimCap,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Log a round' }} />
      <Stack.Screen name="round" options={{ title: 'Log a round' }} />
      <Stack.Screen name="practice" options={{ headerShown: false, title: 'Practice Analyzer' }} />
    </Stack>
  );
}
