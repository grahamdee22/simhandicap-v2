import { useAuth } from '@/src/auth/AuthContext';
import { Redirect, type Href } from 'expo-router';

/**
 * Native entry for the auth stack: onboarding first for new installs, otherwise sign-in.
 * Authenticated users go straight to the app (session restore / cold start).
 */
export default function AuthIndex() {
  const { configured, loading, onboardingReady, onboardingSeen, session } = useAuth();

  if (!onboardingReady || (configured && loading)) {
    return null;
  }

  if (session) {
    return <Redirect href={'/(tabs)' as Href} />;
  }

  if (!onboardingSeen) {
    return <Redirect href={'/(auth)/onboarding' as Href} />;
  }

  return <Redirect href={'/(auth)/sign-in' as Href} />;
}
