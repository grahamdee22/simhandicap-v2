import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItem,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/src/i18n';

const ONBOARDING_BG = '#1a3a2a';

const SLIDE_KEYS = ['1', '2', '3'] as const;

type Slide = { key: string; headline: string; body: string };

type Props = {
  onSkip: () => void;
  onComplete: () => void;
};

export function OnboardingCarousel({ onSkip, onComplete }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);

  const slides = useMemo<Slide[]>(
    () =>
      SLIDE_KEYS.map((key) => ({
        key,
        headline: t(`onboarding.slides.${key}.headline`),
        body: t(`onboarding.slides.${key}.body`),
      })),
    [t]
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) setIndex(first.index);
    },
    []
  );

  const viewabilityConfig = { itemVisiblePercentThreshold: 60 };

  const goNext = useCallback(() => {
    if (index >= slides.length - 1) return;
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  }, [index, slides.length]);

  const renderItem: ListRenderItem<Slide> = useCallback(
    ({ item }) => (
      <View style={[styles.slide, { width }]}>
        <Text style={styles.headline}>{item.headline}</Text>
        <Text style={styles.body}>{item.body}</Text>
      </View>
    ),
    [width]
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const i = Math.round(x / Math.max(1, width));
      setIndex(Math.min(slides.length - 1, Math.max(0, i)));
    },
    [width, slides.length]
  );

  const isLast = index === slides.length - 1;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <View style={styles.topBarSpacer} />
        <Pressable
          onPress={onSkip}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.skipA11y')}
          style={({ pressed }) => [styles.skipBtn, pressed && styles.skipBtnPressed]}
        >
          <Text style={styles.skipTxt}>{t('common.skip')}</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        style={styles.list}
        data={slides}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScrollToIndexFailed={({ index: i }) => {
          setTimeout(() => listRef.current?.scrollToIndex({ index: i, animated: true }), 100);
        }}
      />

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.dots}>
          {slides.map((s, i) => (
            <View
              key={s.key}
              style={[styles.dot, i === index ? styles.dotActive : styles.dotInactive]}
              accessibilityElementsHidden
            />
          ))}
        </View>
        {isLast ? (
          <Pressable
            onPress={onComplete}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.getStartedA11y')}
          >
            <Text style={styles.primaryBtnTxt}>{t('onboarding.getStarted')}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={goNext}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.nextA11y')}
          >
            <Text style={styles.primaryBtnTxt}>{t('common.next')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: ONBOARDING_BG,
    minHeight: 0,
  },
  list: { flex: 1, minHeight: 0 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  topBarSpacer: { flex: 1 },
  skipBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  skipBtnPressed: { opacity: 0.75 },
  skipTxt: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 16,
    fontWeight: '600',
  },
  slide: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 12,
    justifyContent: 'center',
    minHeight: 0,
  },
  headline: {
    fontFamily: 'PlayfairDisplay_900Black',
    fontSize: 28,
    lineHeight: 34,
    color: '#fff',
    marginBottom: 18,
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#fff',
    textAlign: 'center',
    opacity: 0.95,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: { backgroundColor: '#fff' },
  dotInactive: { backgroundColor: 'rgba(255,255,255,0.35)' },
  primaryBtn: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnPressed: { opacity: 0.88 },
  primaryBtnTxt: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
