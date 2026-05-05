import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_SEEN_KEY = '@simcap/onboarding_seen';

export async function getOnboardingSeen(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
    return v === '1';
  } catch {
    return true;
  }
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
