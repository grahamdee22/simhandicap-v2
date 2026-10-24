import type { Href, Router } from 'expo-router';

type BackCapableNavigation = {
  canGoBack: () => boolean;
  goBack: () => void;
};

/** Prefer navigation history; only replace when there is nowhere to go back. */
export function navigateBackOrFallback(
  navigation: BackCapableNavigation,
  router: Router,
  fallback: Href = '/(tabs)' as Href
): void {
  if (navigation.canGoBack()) {
    navigation.goBack();
    return;
  }
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}
