import React, { FC, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { theme } from '../theme';

export type OrbMode = 'idle' | 'listening' | 'speaking' | 'thinking';

const BAR_COUNT = 9;
const BAR_HEIGHT = 36;

const BREATHE_MS: Record<OrbMode, number> = {
  idle: 2800,
  listening: 1700,
  speaking: 800,
  thinking: 1100,
};

/** Pulsing voice orb with ripple rings and a waveform, driven by the call state. */
const VoiceOrb: FC<{ mode: OrbMode; size?: number }> = ({ mode, size = 110 }) => {
  const breathe = useRef(new Animated.Value(0)).current;
  const ripples = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  const bars = useMemo(
    () => Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.15)),
    [],
  );

  // Breathing scale of the orb itself.
  useEffect(() => {
    breathe.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: BREATHE_MS[mode],
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: BREATHE_MS[mode],
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mode, breathe]);

  // Expanding ripple rings, only while a conversation is running.
  useEffect(() => {
    if (mode === 'idle') {
      ripples.forEach(r => r.setValue(0));
      return;
    }
    const duration = mode === 'speaking' ? 1700 : 2600;
    const loops = ripples.map((r, i) => {
      r.setValue(0);
      return Animated.loop(
        Animated.sequence([
          Animated.delay((duration / 2) * i),
          Animated.timing(r, {
            toValue: 1,
            duration,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
    });
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [mode, ripples]);

  // Waveform bars.
  useEffect(() => {
    if (mode === 'idle') {
      bars.forEach(b => b.setValue(0.15));
      return;
    }
    const peak = mode === 'speaking' ? 1 : mode === 'listening' ? 0.5 : 0.3;
    const base = mode === 'speaking' ? 700 : 900;
    const loops = bars.map((b, i) => {
      const ms = base + (i % 4) * 130;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(b, {
            toValue: peak * (0.55 + ((i * 37) % 45) / 100),
            duration: ms / 2,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(b, {
            toValue: 0.15,
            duration: ms / 2,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
    });
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [mode, bars]);

  const coreColor = mode === 'speaking' ? theme.pink : theme.violet;

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size }}>
        {[0.5, 0.95, 1.5].map((spread, i) => (
          <View
            key={'halo' + i}
            style={{
              position: 'absolute',
              top: -size * spread * 0.5,
              left: -size * spread * 0.5,
              width: size * (1 + spread),
              height: size * (1 + spread),
              borderRadius: (size * (1 + spread)) / 2,
              backgroundColor: coreColor,
              opacity: 0.1 - i * 0.03,
            }}
          />
        ))}
        {ripples.map((r, i) => (
          <Animated.View
            key={i}
            style={[
              styles.ring,
              {
                borderRadius: size / 2,
                borderColor: coreColor,
                opacity: r.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                transform: [
                  { scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) },
                ],
              },
            ]}
          />
        ))}
        <Animated.View
          style={[
            styles.core,
            {
              borderRadius: size / 2,
              backgroundColor: coreColor,
              transform: [
                {
                  scale: breathe.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, mode === 'idle' ? 1.04 : 1.1],
                  }),
                },
              ],
            },
          ]}>
          <View
            style={[
              styles.highlight,
              {
                width: size * 0.42,
                height: size * 0.42,
                borderRadius: size * 0.21,
                top: size * 0.14,
                left: size * 0.16,
              },
            ]}
          />
        </Animated.View>
      </View>

      <View style={styles.bars}>
        {bars.map((b, i) => (
          <Animated.View
            key={i}
            style={[
              styles.bar,
              {
                backgroundColor: i % 2 ? theme.blue : theme.pink,
                transform: [{ scaleY: b }],
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
};

export default VoiceOrb;

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
  },
  core: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    elevation: 8,
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  bars: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 18,
  },
  bar: {
    width: 4,
    height: BAR_HEIGHT,
    borderRadius: 2,
  },
});
