import { useNavigation } from '@react-navigation/native';
import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { navigateBackOrFallback } from '../lib/navigateBack';
import { HeaderBackButton } from './HeaderBackButton';

type Props = {
  /** Used only when history is empty (deep link / cold start). */
  fallback?: Href;
};

/** headerLeft for hidden tab screens so back matches Android hardware-back history. */
export function TabScreenBackButton({ fallback = '/(tabs)' as Href }: Props) {
  const navigation = useNavigation();
  const router = useRouter();
  const onPress = useCallback(() => {
    navigateBackOrFallback(navigation, router, fallback);
  }, [navigation, router, fallback]);
  return <HeaderBackButton onPress={onPress} />;
}
