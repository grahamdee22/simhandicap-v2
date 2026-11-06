import { Alert, Platform } from 'react-native';

type ShowAppAlertOptions = {
  /** Runs after the user dismisses the alert. */
  onOk?: () => void;
};

export type AppDialogButton = {
  label: string;
  value: string;
  destructive?: boolean;
};

export type AppDialogRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AppDialogButton[];
  resolve: (value: string) => void;
};

type DialogSubscriber = (request: AppDialogRequest) => void;

let dialogSubscriber: DialogSubscriber | null = null;
let nextDialogId = 1;

/** Web dialog host. Native alerts do not use this. */
export function subscribeAppDialogs(subscriber: DialogSubscriber): () => void {
  dialogSubscriber = subscriber;
  return () => {
    if (dialogSubscriber === subscriber) dialogSubscriber = null;
  };
}

/**
 * In-page dialog on web. `window.alert` / `window.confirm` block the tab until
 * dismissed, and a browser that does not surface the native dialog leaves the
 * page frozen (Auto-assign teams, Cancel).
 * Falls back to the native browser dialog only if the host is not mounted.
 */
function presentWebDialog(input: {
  title: string;
  message?: string;
  buttons: AppDialogButton[];
}): Promise<string> {
  const fallbackValue = () => {
    if (typeof window === 'undefined') return input.buttons[0]?.value ?? '';
    if (input.buttons.length <= 1) {
      window.alert(input.message ? `${input.title}\n\n${input.message}` : input.title);
      return input.buttons[0]?.value ?? 'ok';
    }
    const confirmBtn = input.buttons[input.buttons.length - 1];
    const accepted = window.confirm(
      `${input.title}\n\n${input.message ?? ''}\n\nClick OK to ${confirmBtn?.label.toLowerCase()}.`
    );
    return accepted ? (confirmBtn?.value ?? 'confirm') : (input.buttons[0]?.value ?? 'cancel');
  };

  if (!dialogSubscriber || typeof window === 'undefined') {
    return Promise.resolve(fallbackValue());
  }

  return new Promise((resolve) => {
    dialogSubscriber?.({
      id: nextDialogId++,
      title: input.title,
      message: input.message,
      buttons: input.buttons,
      resolve,
    });
  });
}

function useWebDialog(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

/** Alert.alert is a no-op on react-native-web; the web host shows an in-page dialog. */
export function showAppAlert(title: string, message?: string, options?: ShowAppAlertOptions) {
  if (useWebDialog()) {
    void presentWebDialog({
      title,
      message,
      buttons: [{ label: 'OK', value: 'ok' }],
    }).then(() => options?.onOk?.());
    return;
  }
  if (message != null) {
    Alert.alert(title, message, [{ text: 'OK', onPress: options?.onOk }]);
  } else {
    Alert.alert(title, undefined, [{ text: 'OK', onPress: options?.onOk }]);
  }
}

/** Two-button choice (non-destructive). */
export function confirmAppChoice(
  title: string,
  message: string,
  options?: { cancelText?: string; confirmText?: string }
): Promise<'cancel' | 'confirm'> {
  const cancelText = options?.cancelText ?? 'Go back';
  const confirmText = options?.confirmText ?? 'Proceed anyway';
  if (useWebDialog()) {
    return presentWebDialog({
      title,
      message,
      buttons: [
        { label: cancelText, value: 'cancel' },
        { label: confirmText, value: 'confirm' },
      ],
    }).then((value) => (value === 'confirm' ? 'confirm' : 'cancel'));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel', onPress: () => resolve('cancel') },
      { text: confirmText, onPress: () => resolve('confirm') },
    ]);
  });
}

/** Two-button confirm (destructive action). */
export function confirmDestructive(
  title: string,
  message: string,
  confirmText = 'Delete'
): Promise<boolean> {
  if (useWebDialog()) {
    return presentWebDialog({
      title,
      message,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: confirmText, value: 'confirm', destructive: true },
      ],
    }).then((value) => value === 'confirm');
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
