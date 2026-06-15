import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_SEEN_KEY = '@simcap/onboarding_seen';

const READ_RETRIES = 3;
const READ_RETRY_BASE_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Interpret persisted onboarding flag (`'1'` = seen). */
export function onboardingFlagIsSeen(stored: string | null | undefined): boolean {
  return stored === '1';
}

/**
 * Read onboarding flag with short retries. On persistent failure, default to **not seen**
 * so a fresh install still shows the carousel (never skip onboarding due to storage glitches).
 */
export async function getOnboardingSeen(): Promise<boolean> {
  for (let attempt = 0; attempt < READ_RETRIES; attempt++) {
    try {
      const v = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
      return onboardingFlagIsSeen(v);
    } catch {
      if (attempt < READ_RETRIES - 1) {
        await sleep(READ_RETRY_BASE_MS * (attempt + 1));
      }
    }
  }
  return false;
}

export async function setOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

export async function clearOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ONBOARDING_SEEN_KEY);
  } catch {
    /* ignore */
  }
}
