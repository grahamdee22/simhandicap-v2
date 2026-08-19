import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { Stack, useRouter } from 'expo-router';
import { ForestStackHeader } from '../../../../src/components/ForestStackHeader';
import { colors } from '../../../../src/lib/constants';

function PracticeAnalyzerHeader(props: NativeStackHeaderProps) {
  const router = useRouter();
  return (
    <ForestStackHeader
      {...props}
      forceBack
      onBackPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/log' as never);
      }}
    />
  );
}

export default function PracticeStackLayout() {
  return (
    <Stack
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
      <Stack.Screen
        name="index"
        options={{
          title: 'Practice Analyzer',
          header: (props) => <PracticeAnalyzerHeader {...props} />,
        }}
      />
      <Stack.Screen name="import" options={{ title: 'Import from Computer' }} />
      <Stack.Screen name="[id]" options={{ title: 'Practice analysis' }} />
    </Stack>
  );
}
