import { Alert, Platform } from 'react-native';

type ShowAppAlertOptions = {
  /** Runs after the user dismisses the alert (web: after `window.alert` returns). */
  onOk?: () => void;
};

/** Alert.alert is a no-op on react-native-web; use the browser dialog there. */
export function showAppAlert(title: string, message?: string, options?: ShowAppAlertOptions) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(message ? `${title}\n\n${message}` : title);
    options?.onOk?.();
    return;
  }
  if (message != null) {
    Alert.alert(title, message, [{ text: 'OK', onPress: options?.onOk }]);
  } else {
    Alert.alert(title, undefined, [{ text: 'OK', onPress: options?.onOk }]);
  }
}

/** Two-button confirm (destructive action). Web uses `window.confirm`. */
export function confirmDestructive(
  title: string,
  message: string,
  confirmText = 'Delete'
): Promise<boolean> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
