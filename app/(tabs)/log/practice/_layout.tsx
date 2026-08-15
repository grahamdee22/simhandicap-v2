import { Stack } from 'expo-router';
import { HeaderInstagramAndSimCap } from '../../../../src/components/HeaderInstagramSimCap';
import { colors } from '../../../../src/lib/constants';

export default function PracticeStackLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Practice Analyzer' }} />
      <Stack.Screen name="[id]" options={{ title: 'Practice analysis' }} />
    </Stack>
  );
}
