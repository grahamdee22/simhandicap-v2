import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { Stack, useRouter } from 'expo-router';
import { ForestStackHeader } from '../../../../src/components/ForestStackHeader';
import { useTranslation } from '../../../../src/i18n';
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
  const { t } = useTranslation();

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
          title: t('log.stack.practice'),
          header: (props) => <PracticeAnalyzerHeader {...props} />,
        }}
      />
      <Stack.Screen name="import" options={{ title: t('log.practice.stack.import') }} />
      <Stack.Screen name="[id]" options={{ title: t('log.practice.stack.detail') }} />
    </Stack>
  );
}
