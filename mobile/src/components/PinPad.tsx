import React, { FC, useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { theme } from '../theme';
import { PIN_LENGTH } from '../storage/auth';
import { PressScale } from './anim';
import Icon from './Icon';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

const Dot: FC<{ filled: boolean; error: boolean }> = ({ filled, error }) => {
  const s = useRef(new Animated.Value(filled ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(s, { toValue: filled ? 1 : 0, speed: 30, bounciness: 14, useNativeDriver: true }).start();
  }, [filled, s]);
  return (
    <View style={[styles.dot, error && { borderColor: theme.danger }]}>
      <Animated.View
        style={[
          styles.dotFill,
          { backgroundColor: error ? theme.danger : theme.green, opacity: s, transform: [{ scale: s }] },
        ]}
      />
    </View>
  );
};

/**
 * PIN dots + number pad. `shakeKey` changes -> the dots shake (use after a wrong PIN).
 * `onComplete` fires once the last digit is entered.
 */
const PinPad: FC<{
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  shakeKey?: number;
  error?: boolean;
  disabled?: boolean;
}> = ({ value, onChange, onComplete, shakeKey = 0, error = false, disabled = false }) => {
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!shakeKey) {
      return;
    }
    Vibration.vibrate(60);
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 90, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 90, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeKey, shake]);

  const press = (k: string) => {
    if (disabled || !k) {
      return;
    }
    if (k === '⌫') {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= PIN_LENGTH) {
      return;
    }
    const next = value + k;
    onChange(next);
    if (next.length === PIN_LENGTH) {
      onComplete?.(next);
    }
  };

  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.View
        style={[styles.dots, { transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-14, 14] }) }] }]}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <Dot key={i} filled={i < value.length} error={error} />
        ))}
      </Animated.View>
      <View style={styles.pad}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <View key={i} style={styles.key} />
          ) : (
            <PressScale key={i} onPress={() => press(k)} disabled={disabled} style={styles.key} scaleTo={0.86}>
              <View style={[styles.keyInner, k === '⌫' && { backgroundColor: 'transparent' }]}>
                {k === '⌫' ? <Icon name="delete" size={26} color={theme.mute} /> : <Text style={styles.keyText}>{k}</Text>}
              </View>
            </PressScale>
          ),
        )}
      </View>
    </View>
  );
};

export default PinPad;

const SIZE = 74;
const styles = StyleSheet.create({
  dots: { flexDirection: 'row', marginBottom: 28, height: 24 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.dim, marginHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  dotFill: { width: 14, height: 14, borderRadius: 7 },
  pad: { width: SIZE * 3 + 36, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  key: { width: SIZE, height: SIZE, marginBottom: 12, alignItems: 'center', justifyContent: 'center' },
  keyInner: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.line },
  keyText: { color: theme.text, fontSize: 28, fontWeight: '600' },
});

// Re-exported so screens can show a plain text link without importing RN pieces twice.
export const LinkText: FC<{ text: string; onPress: () => void; color?: string }> = ({ text, onPress, color = theme.blue }) => (
  <TouchableOpacity onPress={onPress} hitSlop={10}>
    <Text style={{ color, fontWeight: '700', fontSize: 14 }}>{text}</Text>
  </TouchableOpacity>
);
