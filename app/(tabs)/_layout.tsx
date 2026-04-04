import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SimCapMark } from '../../src/components/SimCapMark';
import { TabBarSvgIcon, type TabBarSvgName } from '../../src/components/TabBarSvgIcon';
import { colors } from '../../src/lib/constants';

function HeaderSimCapMark() {
  return (
    <View style={styles.headerMarkWrap}>
      <SimCapMark size={42} />
    </View>
  );
}

/** Mock: compact icons sitting in the upper half of the bar with labels beneath. */
const TAB_ICON_SIZE = 22;

function TabIcon({ name, color }: { name: TabBarSvgName; color: string }) {
  return (
    <View style={styles.iconSlot}>
      <TabBarSvgIcon name={name} color={color} size={TAB_ICON_SIZE} />
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  /**
   * React Navigation fixes default tab bar height (~49pt) before merging tabBarStyle.
   * Icon + label below needs a taller bar; set explicit height so labels are not clipped.
   * Do NOT set alignItems: 'center' on the bar — default column stretch keeps the tab row full width.
   */
  /** Web: no artificial bottom pad — removes dead space under labels (insets still apply on real devices). */
  const bottomInset = Platform.OS === 'web' ? insets.bottom : Math.max(insets.bottom, 8);
  const barPadTop = 3;
  /**
   * Must clear React Navigation’s tab button: padding 5×2 + TabBarIcon uikit ~28px tall
   * + icon marginBottom + label lineHeight/descenders (~16px).
   */
  const barRow = 62;
  const tabBarHeight = barPadTop + barRow + bottomInset;

  return (
    <Tabs
      detachInactiveScreens={false}
      screenOptions={{
        animation: 'none',
        ...(Platform.OS === 'web' ? { sceneStyle: { flex: 1, minHeight: 0 } } : {}),
        tabBarShowLabel: true,
        tabBarLabelPosition: 'below-icon',
        /** Mock: forest green family; active tab reads slightly stronger. */
        tabBarActiveTintColor: colors.header,
        tabBarInactiveTintColor: 'rgba(26,61,43,0.42)',
        tabBarHideOnKeyboard: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: tabBarHeight,
          paddingTop: barPadTop,
          paddingBottom: bottomInset,
          width: '100%',
          ...Platform.select({
            web: {
              boxShadow: '0 -4px 24px rgba(26,26,26,0.07)',
              overflow: 'visible',
              boxSizing: 'border-box' as const,
            },
            ios: {
              shadowColor: colors.header,
              shadowOffset: { width: 0, height: -3 },
              shadowOpacity: 0.08,
              shadowRadius: 10,
              overflow: 'visible',
            },
            default: { elevation: 12, overflow: 'visible' },
          }),
        },
        tabBarIconStyle: {
          marginTop: 0,
          marginBottom: 4,
        },
        tabBarItemStyle: {
          flex: 1,
          minWidth: 0,
          paddingTop: 0,
          paddingBottom: 0,
          justifyContent: 'center',
          alignItems: 'center',
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.15,
          marginTop: 0,
          marginBottom: 0,
          lineHeight: 14,
          paddingBottom: Platform.OS === 'web' ? 1 : 0,
        },
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: '#fff',
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700', fontSize: 22 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'SimHandicap',
          headerShown: false,
          tabBarLabel: 'Home',
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: 'Log a round',
          headerRight: HeaderSimCapMark,
          tabBarLabel: 'Log',
          tabBarIcon: ({ color }) => <TabIcon name="add-circle" color={color} />,
        }}
      />
      <Tabs.Screen
        name="analyze"
        options={{
          title: 'Round analysis',
          headerRight: HeaderSimCapMark,
          tabBarLabel: 'Trends',
          tabBarIcon: ({ color }) => <TabIcon name="analytics" color={color} />,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          headerRight: HeaderSimCapMark,
          tabBarLabel: 'Social',
          tabBarIcon: ({ color }) => <TabIcon name="people" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerRight: HeaderSimCapMark,
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color }) => <TabIcon name="person" color={color} />,
        }}
      />
      <Tabs.Screen
        name="round/[id]"
        options={{
          href: null,
          title: 'Round detail',
          tabBarLabel: 'Round',
        }}
      />
      <Tabs.Screen
        name="net-calculator"
        options={{
          href: null,
          title: 'Net calculator',
          headerRight: HeaderSimCapMark,
          tabBarLabel: 'Net',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconSlot: {
    width: 32,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMarkWrap: {
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 48,
    minHeight: 48,
  },
});
