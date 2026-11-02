import React, { FC, useEffect, useRef } from 'react';
import { Animated, Easing, StatusBar, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { AnimatedWordmark, Logo, FloatingDollars } from './anim';

const SHOW_MS = 2900;

/**
 * Animated launch screen: dollar symbols rain down, the app logo pops in and
 * spins, the FINTRACK name drops in letter by letter, then everything fades.
 */
const SplashScreen: FC<{ onDone: () => void }> = ({ onDone }) => {
  const pop = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(250),
      Animated.spring(pop, { toValue: 1, speed: 7, bounciness: 16, useNativeDriver: true }),
    ]).start();
    Animated.timing(tagline, { toValue: 1, duration: 600, delay: 1500, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(out, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(
        () => onDone(),
      );
    }, SHOW_MS);
    return () => clearTimeout(t);
  }, [pop, tagline, out, onDone]);

  return (
    <Animated.View style={[styles.root, { opacity: out }]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <FloatingDollars down count={26} maxOpacity={0.55} />
      <View style={styles.center}>
        <Animated.View style={{ transform: [{ scale: pop }, { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ['-40deg', '0deg'] }) }] }}>
          <Logo size={112} spin />
        </Animated.View>
        <View style={{ marginTop: 6 }}>
          <AnimatedWordmark size={38} delay={700} />
        </View>
        <Animated.Text style={[styles.tagline, { opacity: tagline, transform: [{ translateY: tagline.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
          Track every penny. Own every debt.
        </Animated.Text>
      </View>
      <Text style={styles.footer}>Money · Debts · EMIs · Reminders</Text>
    </Animated.View>
  );
};

export default SplashScreen;

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: theme.bg, zIndex: 50 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glowTop: { position: 'absolute', top: -140, left: -120, width: 380, height: 380, borderRadius: 190, backgroundColor: theme.green, opacity: 0.12 },
  glowBottom: { position: 'absolute', bottom: -160, right: -120, width: 400, height: 400, borderRadius: 200, backgroundColor: theme.violet, opacity: 0.16 },
  tagline: { color: theme.mute, marginTop: 14, fontSize: 14, letterSpacing: 0.6 },
  footer: { position: 'absolute', bottom: 34, alignSelf: 'center', color: theme.dim, fontSize: 12, letterSpacing: 1.2 },
});
