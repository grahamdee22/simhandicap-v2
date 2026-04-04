import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

type Props = { size: number; color: string };

function Slot({ size, children }: { size: number; children: ReactNode }) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {children}
      </Svg>
    </View>
  );
}

/** Chevron right — replaces Ionicons chevron-forward */
export function IconChevronForward({ size, color }: Props) {
  return (
    <Slot size={size}>
      <Path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Slot>
  );
}

/** Check — replaces Ionicons checkmark */
export function IconCheckmark({ size, color }: Props) {
  return (
    <Slot size={size}>
      <Path
        fill={color}
        d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
      />
    </Slot>
  );
}

/** Golf flag — replaces Ionicons golf */
export function IconGolf({ size, color }: Props) {
  return (
    <Slot size={size}>
      <Line x1="7" y1="20" x2="7" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M7 5 L17 9 L7 13 Z" fill={color} />
    </Slot>
  );
}

/** Plain plus — replaces Ionicons add */
export function IconPlus({ size, color }: Props) {
  return (
    <Slot size={size}>
      <Line x1="12" y1="6" x2="12" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="6" y1="12" x2="18" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Slot>
  );
}

/** Circle + plus outline — replaces Ionicons add-circle-outline */
export function IconAddCircleOutline({ size, color }: Props) {
  return (
    <Slot size={size}>
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.75" fill="none" />
      <Line x1="12" y1="8.5" x2="12" y2="15.5" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Line x1="8.5" y1="12" x2="15.5" y2="12" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
    </Slot>
  );
}

/** Calendar — replaces Ionicons calendar-outline */
export function IconCalendarOutline({ size, color }: Props) {
  return (
    <Slot size={size}>
      <Rect x="4" y="5" width="16" height="15" rx="2" stroke={color} strokeWidth="1.6" fill="none" />
      <Line x1="4" y1="10" x2="20" y2="10" stroke={color} strokeWidth="1.6" />
      <Line x1="8" y1="3.5" x2="8" y2="7" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Line x1="16" y1="3.5" x2="16" y2="7" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </Slot>
  );
}

/** Bar chart — replaces Ionicons analytics */
export function IconAnalyticsBars({ size, color }: Props) {
  return (
    <Slot size={size}>
      <Rect x="4" y="14" width="4" height="6" rx="1" fill={color} />
      <Rect x="10" y="10" width="4" height="10" rx="1" fill={color} />
      <Rect x="16" y="6" width="4" height="14" rx="1" fill={color} />
    </Slot>
  );
}

/** Trash — replaces Ionicons trash-outline */
export function IconTrashOutline({ size, color }: Props) {
  return (
    <Slot size={size}>
      <Path
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 7h6l1 2.5H8L9 7zm-2.5 2.5h13L18 20a1 1 0 01-1 1H7a1 1 0 01-1-1l-.5-10.5zM10 11.5V17M14 11.5V17"
      />
    </Slot>
  );
}
