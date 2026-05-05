import { useRouter } from 'expo-router';
import { OnboardingCarousel } from '@/src/components/OnboardingCarousel';
import { useAuth } from '@/src/auth/AuthContext';

export default function OnboardingScreen() {
  const router = useRouter();
  const { completeOnboarding } = useAuth();

  const goAuth = async (href: '/(auth)/sign-in' | '/(auth)/sign-up') => {
    await completeOnboarding();
    router.replace(href);
  };

  return (
    <OnboardingCarousel
      onSkip={() => void goAuth('/(auth)/sign-in')}
      onComplete={() => void goAuth('/(auth)/sign-up')}
    />
  );
}
