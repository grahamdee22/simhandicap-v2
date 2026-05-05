import * as ImagePicker from 'expo-image-picker';
import type { ImagePickerOptions } from 'expo-image-picker';
import { Platform } from 'react-native';

const QUALITY = 0.85;

/**
 * Library options for sim settings screenshots. On iOS/Android we use
 * `allowsMultipleSelection` + `selectionLimit: 1` so the system picker shows an explicit
 * add/done flow instead of a single-tap mode that can strand users without a working Done/Cancel.
 * iOS also uses full-screen presentation so toolbar buttons are not clipped under the nav stack.
 */
export function settingsScreenshotPickerOptions(): ImagePickerOptions {
  const base: ImagePickerOptions = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: QUALITY,
  };
  if (Platform.OS === 'web') {
    return { ...base, allowsMultipleSelection: false };
  }
  return {
    ...base,
    allowsMultipleSelection: true,
    selectionLimit: 1,
    ...(Platform.OS === 'ios'
      ? { presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN }
      : {}),
  };
}
