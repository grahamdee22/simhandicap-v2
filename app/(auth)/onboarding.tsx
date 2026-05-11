import { useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { OnboardingCarousel } from '@/src/components/OnboardingCarousel';
import { useAuth } from '@/src/auth/AuthContext';
import { supabase } from '@/src/lib/supabase';

export default function OnboardingScreen() {
  const router = useRouter();
  const { completeOnboarding } = useAuth();

  useEffect(() => {
    if (Platform.OS === 'web') {
      router.replace('/(auth)/sign-in');
    }
  }, [router]);

  const goAuth = async (href: '/(auth)/sign-in' | '/(auth)/sign-up') => {
    await completeOnboarding();
    // If user is already authenticated (e.g. came from OAuth), go straight to the app
    const { data } = await supabase!.auth.getSession();
    if (data.session) {
      router.replace('/(tabs)' as Href);
    } else {
      router.replace(href);
    }
  };

  if (Platform.OS === 'web') return null;

  return (
    <OnboardingCarousel
      onSkip={() => void goAuth('/(auth)/sign-in')}
      onComplete={() => void goAuth('/(auth)/sign-up')}
    />
  );
}
