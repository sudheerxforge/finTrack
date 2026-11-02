import React, { FC, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { theme } from '../theme';

/** Fades and slides its children up when they first appear. Stagger with `delay`. */
export const Reveal: FC<{ children: ReactNode; delay?: number; style?: StyleProp<ViewStyle>; distance?: number }> = ({
  children,
  delay = 0,
  style,
  distance = 18,
}) => {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 480,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [v, delay]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] },
      ]}>
      {children}
    </Animated.View>
  );
};

/** Counts a number up (or down) to `value` whenever it changes. */
export const CountUp: FC<{
  value: number;
  format: (n: number) => string;
  style?: StyleProp<TextStyle>;
  duration?: number;
}> = ({ value, format, style, duration = 900 }) => {
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setShown(v));
    anim.setValue(last.current);
    Animated.timing(anim, { toValue: value, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(
      () => {
        last.current = value;
      },
    );
    return () => anim.removeListener(id);
  }, [value, duration, anim]);
  return <Text style={style}>{format(shown)}</Text>;
};

/** Shrinks slightly while pressed, springs back on release. */
export const PressScale: FC<{
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  accessibilityLabel?: string;
}> = ({ children, onPress, onLongPress, disabled, style, scaleTo = 0.95, accessibilityLabel }) => {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(s, { toValue: v, speed: 40, bounciness: 8, useNativeDriver: true }).start();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}>
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
};

interface Drop {
  x: number;
  size: number;
  duration: number;
  delay: number;
  sway: number;
  rotate: number;
  opacity: number;
  glyph: string;
  color: string;
}

// The app icon's palette: mint green, blue, cyan and white.
const COLORS = [theme.green, theme.blue, '#14E8A5', '#6FB1FF', '#D6FFEE'];

/**
 * Dollar symbols drifting across the screen. `down` makes them fall (splash);
 * otherwise they float upward slowly (login / backgrounds).
 */
export const FloatingDollars: FC<{ count?: number; down?: boolean; speed?: number; maxOpacity?: number }> = ({
  count = 16,
  down = false,
  speed = 1,
  maxOpacity = 0.35,
}) => {
  const { width, height } = useWindowDimensions();
  const drops = useMemo<Drop[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: Math.random() * (width - 24),
        size: 16 + Math.random() * 34,
        duration: (down ? 2600 : 7000 + Math.random() * 6000) / speed + Math.random() * 1500,
        delay: Math.random() * (down ? 1400 : 6000),
        sway: 10 + Math.random() * 26,
        rotate: (Math.random() - 0.5) * 60,
        opacity: maxOpacity * (0.45 + Math.random() * 0.55),
        glyph: '₹',
        color: COLORS[i % COLORS.length],
      })),
    [count, width, down, speed, maxOpacity],
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {drops.map((d, i) => (
        <Drift key={i} d={d} h={height} down={down} />
      ))}
    </View>
  );
};

const Drift: FC<{ d: Drop; h: number; down: boolean }> = ({ d, h, down }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: d.duration, delay: d.delay, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, d]);
  const from = down ? -80 : h + 40;
  const to = down ? h + 40 : -80;
  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left: d.x,
        top: 0,
        fontSize: d.size,
        fontWeight: '800',
        color: d.color,
        opacity: t.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, d.opacity, d.opacity, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) },
          { translateX: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, d.sway, 0] }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: [`${-d.rotate}deg`, `${d.rotate}deg`] }) },
        ],
      }}>
      {d.glyph}
    </Animated.Text>
  );
};

/** The app icon, used as the logo everywhere. `spin` flips it around; `glow` pulses a halo. */
export const Logo: FC<{ size?: number; spin?: boolean; glow?: boolean }> = ({ size = 96, spin = false, glow = true }) => {
  const flip = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loops: Animated.CompositeAnimation[] = [];
    if (spin) {
      loops.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(flip, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
            Animated.delay(900),
          ]),
        ),
      );
    }
    if (glow) {
      loops.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        ),
      );
    }
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [spin, glow, flip, pulse]);

  // A flip looks like scaleX going 1 -> 0 -> 1 twice.
  const scaleX = spin ? flip.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 0.02, 1, 0.02, 1] }) : 1;

  return (
    <View style={{ width: size * 1.7, height: size * 1.7, alignItems: 'center', justifyContent: 'center' }}>
      {glow && (
        <Animated.View
          style={{
            position: 'absolute',
            width: size * 1.5,
            height: size * 1.5,
            borderRadius: size * 0.75,
            backgroundColor: theme.green,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.3] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.1] }) }],
          }}
        />
      )}
      <Animated.Image
        source={require('../assets/logo.png')}
        style={{ width: size, height: size, borderRadius: size / 2, transform: [{ scaleX: scaleX as any }] }}
        accessibilityLabel="FINTRACK logo"
      />
    </View>
  );
};

/** "FINTRACK" with each letter dropping in one after another. */
export const AnimatedWordmark: FC<{ size?: number; delay?: number; text?: string }> = ({
  size = 34,
  delay = 0,
  text = 'FINTRACK',
}) => {
  const letters = text.split('');
  const vals = useRef(letters.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(
      70,
      vals.map(v => Animated.spring(v, { toValue: 1, delay, speed: 12, bounciness: 12, useNativeDriver: true })),
    ).start();
  }, [vals, delay]);
  return (
    <View style={{ flexDirection: 'row' }}>
      {letters.map((l, i) => (
        <Animated.Text
          key={i}
          style={{
            fontSize: size,
            fontWeight: '900',
            letterSpacing: 3,
            color: i >= 3 ? theme.green : theme.text,
            opacity: vals[i],
            transform: [{ translateY: vals[i].interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }, { scale: vals[i] }],
          }}>
          {l}
        </Animated.Text>
      ))}
    </View>
  );
};
