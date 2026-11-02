import React, { FC, ReactNode, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { theme } from '../theme';
import { PressScale } from './anim';
import Icon, { IconName } from './Icon';
import { useKeyboardHeight } from '../utils/keyboard';

export const Card: FC<{ children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }> = ({
  children,
  style,
  onPress,
}) =>
  onPress ? (
    <PressScale onPress={onPress} scaleTo={0.975}>
      <View style={[s.card, style]}>{children}</View>
    </PressScale>
  ) : (
    <View style={[s.card, style]}>{children}</View>
  );

export const SectionTitle: FC<{ children: ReactNode; right?: ReactNode }> = ({ children, right }) => (
  <View style={s.sectionRow}>
    <Text style={s.sectionTitle}>{children}</Text>
    {right}
  </View>
);

export const Button: FC<{
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}> = ({ title, onPress, kind = 'primary', disabled, small, icon, style }) => (
  <PressScale onPress={onPress} disabled={disabled} scaleTo={0.94} style={style}>
    <View
      style={[
        s.btn,
        small && s.btnSmall,
        kind === 'primary' && { backgroundColor: theme.blue },
        kind === 'ghost' && { backgroundColor: theme.cardSoft },
        kind === 'danger' && { backgroundColor: 'rgba(248,113,113,0.18)' },
        disabled && { opacity: 0.45 },
      ]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {icon && (
          <View style={{ marginRight: 7 }}>
            <Icon name={icon} size={small ? 15 : 18} color={kind === 'danger' ? theme.danger : '#fff'} />
          </View>
        )}
        <Text style={[s.btnText, small && { fontSize: 13 }, kind === 'danger' && { color: theme.danger }]}>{title}</Text>
      </View>
    </View>
  </PressScale>
);

export const Field: FC<TextInputProps & { label: string; hint?: string }> = ({ label, hint, style, ...rest }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={s.label}>{label}</Text>
    <TextInput
      placeholderTextColor={theme.dim}
      {...rest}
      style={[s.input, rest.multiline && { height: 70, textAlignVertical: 'top' }, style]}
    />
    {hint ? <Text style={s.hint}>{hint}</Text> : null}
  </View>
);

/** Row of tappable pills; `value` is the selected option. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
      {options.map(o => (
        <TouchableOpacity
          key={o}
          onPress={() => onChange(o)}
          style={[s.chip, o === value && { backgroundColor: theme.blue, borderColor: theme.blue }]}>
          <Text style={[s.chipText, o === value && { color: '#fff' }]}>{labels?.[o] ?? o}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

/** Bottom sheet with a title; closes when the backdrop is tapped. */
export const Sheet: FC<{ visible: boolean; title: string; onClose: () => void; children: ReactNode }> = ({
  visible,
  title,
  onClose,
  children,
}) => {
  const kb = useKeyboardHeight();
  const { height } = useWindowDimensions();
  // Sit right above the keyboard, and never taller than the space that is left.
  const maxHeight = Math.max(260, Math.min(height * 0.88, height - kb - 56));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={[s.sheet, { bottom: kb, maxHeight }]}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Icon name="x" size={22} color={theme.mute} />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export const ProgressBar: FC<{ value: number; color?: string }> = ({ value, color = theme.blue }) => {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(w, {
      toValue: Math.max(0, Math.min(1, value)),
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [value, w]);
  return (
    <View style={s.track}>
      <Animated.View
        style={{
          height: '100%',
          width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          backgroundColor: color,
          borderRadius: 4,
        }}
      />
    </View>
  );
};

/** Round floating action button that pops in and presses down. */
export const Fab: FC<{ onPress: () => void }> = ({ onPress }) => {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, delay: 300, speed: 10, bounciness: 16, useNativeDriver: true }).start();
  }, [pop]);
  return (
    <Animated.View style={[s.fab, { transform: [{ scale: pop }, { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] }) }] }]}>
      <PressScale onPress={onPress} scaleTo={0.88} accessibilityLabel="Add" style={s.fabInner}>
        <Icon name="plus" size={28} color="#fff" strokeWidth={2.4} />
      </PressScale>
    </Animated.View>
  );
};

export const Empty: FC<{ text: string }> = ({ text }) => (
  <View style={{ padding: 28, alignItems: 'center' }}>
    <Text style={{ color: theme.dim, textAlign: 'center', lineHeight: 20 }}>{text}</Text>
  </View>
);

export const Badge: FC<{ text: string; color: string }> = ({ text, color }) => (
  <View style={{ backgroundColor: color + '26', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
    <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{text}</Text>
  </View>
);

export const s = StyleSheet.create({
  card: { backgroundColor: theme.card, borderRadius: 18, padding: 16, marginBottom: 12 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 10 },
  sectionTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  btn: { paddingVertical: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  label: { color: theme.mute, fontSize: 12, marginBottom: 5, fontWeight: '600' },
  hint: { color: theme.dim, fontSize: 11, marginTop: 4 },
  input: {
    backgroundColor: theme.cardSoft,
    color: theme.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 9,
    fontSize: 15,
    borderWidth: 1,
    borderColor: theme.line,
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.line,
    marginRight: 8,
    backgroundColor: theme.cardSoft,
  },
  chipText: { color: theme.mute, fontSize: 13, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: theme.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { color: theme.text, fontSize: 18, fontWeight: '800' },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: theme.blue, elevation: 8 },
  fabInner: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  track: { height: 8, backgroundColor: theme.cardSoft, borderRadius: 4, overflow: 'hidden' },
});
