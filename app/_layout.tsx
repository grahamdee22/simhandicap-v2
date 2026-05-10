import 'react-native-gesture-handler';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { PlayfairDisplay_900Black } from '@expo-google-fonts/playfair-display';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { AuthProvider, useAuth } from '@/src/auth/AuthContext';
import { BrandedSplashGate } from '@/src/components/BrandedSplashGate';
import { colors } from '@/src/lib/constants';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

const rootWeb = {
  flex: 1,
  width: '100%' as const,
  minHeight: 0,
  height: '100%' as const,
  maxHeight: '100%' as const,
  display: 'flex' as const,
  flexDirection: 'column' as const,
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    PlayfairDisplay_900Black,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <AuthProvider>
      <BrandedSplashGate>
        <RootLayoutNav />
      </BrandedSplashGate>
    </AuthProvider>
  );
}

function RootLayoutNav() {
  const { configured, loading, onboardingReady } = useAuth();
  const colorScheme = useColorScheme();

  if ((configured && loading) || !onboardingReady) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <GestureHandlerRootView
        style={[
          { flex: 1, width: '100%', backgroundColor: colors.bg, minHeight: 0 },
          Platform.OS === 'web' ? (rootWeb as object) : {},
        ]}
      >
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.header },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '600', fontSize: 15 },
            contentStyle: {
              flex: 1,
              minHeight: 0,
              backgroundColor: colors.bg,
              ...(Platform.OS === 'web' ? { height: '100%' as const } : {}),
            },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
