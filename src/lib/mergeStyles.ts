import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Recursively merges style props into one plain object for react-native-web.
 * Prevents nested arrays from reaching the DOM `style` prop (which throws
 * "Indexed property setter is not supported").
 */
export function mergeViewStyles(
  ...inputs: (StyleProp<ViewStyle> | false | null | undefined)[]
): ViewStyle | undefined {
  const out: ViewStyle = {} as ViewStyle;
  const stack: StyleProp<ViewStyle>[] = [];

  // Push last argument first so pops apply in mergeViewStyles(A,B,C) order A→B→C (C wins on conflicts).
  for (let i = inputs.length - 1; i >= 0; i--) {
    const input = inputs[i];
    if (input == null || input === false) continue;
    stack.push(input);
  }

  while (stack.length > 0) {
    const item = stack.pop();
    if (item == null || item === false) continue;
    if (Array.isArray(item)) {
      for (let i = item.length - 1; i >= 0; i--) stack.push(item[i] as StyleProp<ViewStyle>);
      continue;
    }
    const flat = StyleSheet.flatten(item);
    if (flat && typeof flat === 'object' && !Array.isArray(flat)) {
      Object.assign(out, flat);
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
