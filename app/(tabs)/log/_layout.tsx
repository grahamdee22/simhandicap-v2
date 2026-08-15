import { Stack } from 'expo-router';
import { ForestStackHeader } from '../../../src/components/ForestStackHeader';
import { colors } from '../../../src/lib/constants';
import { PRACTICE_ANALYZER_ENABLED } from '../../../src/lib/featureFlags';

/**
 * Center-tab stack: choice screen → Log a Round or Analyze Practice.
 * When Practice Analyzer is disabled, open Log a Round directly (choice redirects too).
 * Custom header avoids native headerRight liquid-glass/pill wrapping.
 */
export default function LogStackLayout() {
  return (
    <Stack
      initialRouteName={PRACTICE_ANALYZER_ENABLED ? 'index' : 'round'}
      screenOptions={{
        header: (props) => <ForestStackHeader {...props} />,
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: '#fff',
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        headerTitleStyle: { fontWeight: '700', fontSize: 22 },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Log a round' }} />
      <Stack.Screen name="round" options={{ title: 'Log a round' }} />
      <Stack.Screen name="practice" options={{ headerShown: false, title: 'Practice Analyzer' }} />
    </Stack>
  );
}
