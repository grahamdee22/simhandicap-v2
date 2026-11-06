import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { subscribeAppDialogs, type AppDialogRequest } from '../lib/alertCompat';
import { colors } from '../lib/constants';

/**
 * Renders web alerts in the page. Native `window.confirm` blocks the tab, so a
 * browser that hides that dialog looks frozen until the tab is closed.
 */
export function WebAppDialogHost() {
  const [current, setCurrent] = useState<AppDialogRequest | null>(null);
  const queue = useRef<AppDialogRequest[]>([]);

  useEffect(() => {
    return subscribeAppDialogs((request) => {
      setCurrent((open) => {
        if (open) {
          queue.current.push(request);
          return open;
        }
        return request;
      });
    });
  }, []);

  const finish = (value: string) => {
    current?.resolve(value);
    const next = queue.current.shift() ?? null;
    setCurrent(next);
  };

  return (
    <Modal
      visible={current != null}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (current) finish(current.buttons[0]?.value ?? 'cancel');
      }}
    >
      {current ? (
        <View style={styles.root}>
          <Pressable
            style={styles.backdrop}
            onPress={() => finish(current.buttons[0]?.value ?? 'cancel')}
            accessibilityLabel="Dismiss"
          />
          <View
            style={styles.card}
            accessibilityRole="alert"
            testID="app-dialog"
          >
            <Text style={styles.title}>{current.title}</Text>
            {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
            <View style={styles.actions}>
              {current.buttons.map((button, index) => {
                const isConfirm = index === current.buttons.length - 1;
                return (
                  <Pressable
                    key={`${current.id}-${button.value}`}
                    style={[
                      styles.btn,
                      isConfirm ? styles.btnConfirm : styles.btnCancel,
                      button.destructive && styles.btnDanger,
                    ]}
                    onPress={() => finish(button.value)}
                    accessibilityRole="button"
                    testID={isConfirm ? 'app-dialog-confirm' : 'app-dialog-cancel'}
                  >
                    <Text
                      style={[
                        styles.btnTxt,
                        isConfirm ? styles.btnTxtConfirm : styles.btnTxtCancel,
                      ]}
                    >
                      {button.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26, 26, 26, 0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
  },
  message: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    color: colors.muted,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18,
  },
  btn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  btnCancel: {
    backgroundColor: colors.accentSoft,
  },
  btnConfirm: {
    backgroundColor: colors.header,
  },
  btnDanger: {
    backgroundColor: colors.danger,
  },
  btnTxt: {
    fontSize: 15,
    fontWeight: '600',
  },
  btnTxtCancel: {
    color: colors.accentDark,
  },
  btnTxtConfirm: {
    color: '#fff',
  },
});
