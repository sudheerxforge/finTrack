import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, LayoutChangeEvent, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { Button, Field, Sheet } from './ui';
import Icon, { IconName } from './Icon';
import { PressScale } from './anim';
import { useStore } from '../state/store';
import {
  MONTH_NAMES,
  addMonthKey,
  dateInMonth,
  daysInMonth,
  formatTime12,
  addDaysISO,
  isValidISO,
  pad,
  prettyDateOrd,
  today,
} from '../utils/dates';

// ---------------------------------------------------------------- Segmented ---
export interface SegOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/** Two or three choices in a pill, with a thumb that slides to the chosen one. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<SegOption<T>>;
  value: T;
  onChange: (v: T) => void;
}) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex(o => o.value === value));
  const x = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: idx, speed: 18, bounciness: 8, useNativeDriver: true }).start();
  }, [idx, x]);
  const thumbW = w > 0 ? (w - 8) / options.length : 0;
  return (
    <View style={styles.segWrap} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      {thumbW > 0 && (
        <Animated.View style={[styles.segThumb, { width: thumbW, transform: [{ translateX: Animated.multiply(x, thumbW) }] }]} />
      )}
      {options.map(o => {
        const active = o.value === value;
        return (
          <TouchableOpacity key={o.value} style={styles.segItem} onPress={() => onChange(o.value)} activeOpacity={0.8}>
            {o.icon && <Icon name={o.icon} size={15} color={active ? '#04201a' : theme.mute} strokeWidth={2.3} />}
            <Text style={[styles.segText, active && { color: '#04201a' }, o.icon ? { marginLeft: 6 } : null]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// -------------------------------------------------------------- field shell ---
const PickerButton: FC<{
  label: string;
  text?: string;
  placeholder: string;
  icon: IconName;
  onPress: () => void;
  onClear?: () => void;
  hint?: string;
}> = ({ label, text, placeholder, icon, onPress, onClear, hint }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={styles.label}>{label}</Text>
    <PressScale onPress={onPress} scaleTo={0.985}>
      <View style={styles.pickBtn}>
        <Icon name={icon} size={18} color={text ? theme.green : theme.dim} />
        <Text style={[styles.pickText, !text && { color: theme.dim }]}>{text || placeholder}</Text>
        {text && onClear ? (
          <TouchableOpacity onPress={onClear} hitSlop={10}>
            <Icon name="x" size={16} color={theme.mute} />
          </TouchableOpacity>
        ) : (
          <Icon name="chevron-right" size={18} color={theme.dim} />
        )}
      </View>
    </PressScale>
    {hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>
);

// ---------------------------------------------------------------- DatePicker ---
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A tappable field that opens a calendar and shows the date like "26th Nov 2026". */
export const DatePickerField: FC<{
  label: string;
  value: string; // YYYY-MM-DD or ''
  onChange: (iso: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  hint?: string;
}> = ({ label, value, onChange, placeholder = 'Select a date', allowClear, hint }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PickerButton
        label={label}
        text={value && isValidISO(value) ? prettyDateOrd(value) : undefined}
        placeholder={placeholder}
        icon="calendar"
        onPress={() => setOpen(true)}
        onClear={allowClear ? () => onChange('') : undefined}
        hint={hint}
      />
      <CalendarSheet
        visible={open}
        value={value}
        onClose={() => setOpen(false)}
        onPick={iso => {
          onChange(iso);
          setOpen(false);
        }}
      />
    </>
  );
};

const CalendarSheet: FC<{ visible: boolean; value: string; onClose: () => void; onPick: (iso: string) => void }> = ({
  visible,
  value,
  onClose,
  onPick,
}) => {
  const selected = value && isValidISO(value) ? value : '';
  const [month, setMonth] = useState((selected || today()).slice(0, 7));
  // Open on the selected date's month each time.
  useEffect(() => {
    if (visible) {
      setMonth((selected || today()).slice(0, 7));
    }
  }, [visible, selected]);

  const [y, m] = month.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay(); // blanks before the 1st
  const total = daysInMonth(y, m);
  const cells = useMemo(() => {
    const out: Array<number | null> = Array(lead).fill(null);
    for (let d = 1; d <= total; d++) {
      out.push(d);
    }
    while (out.length % 7) {
      out.push(null);
    }
    return out;
  }, [lead, total]);
  const t = today();

  return (
    <Sheet visible={visible} title="Select date" onClose={onClose}>
      <View style={styles.calHead}>
        <TouchableOpacity onPress={() => setMonth(addMonthKey(month, -1))} hitSlop={12} style={styles.calNav}>
          <Icon name="chevron-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.calTitle}>
          {MONTH_NAMES[m - 1]} {y}
        </Text>
        <TouchableOpacity onPress={() => setMonth(addMonthKey(month, 1))} hitSlop={12} style={styles.calNav}>
          <Icon name="chevron-right" size={22} color={theme.text} />
        </TouchableOpacity>
      </View>
      <View style={styles.calRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.calWeek}>
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.calGrid}>
        {cells.map((d, i) => {
          if (d === null) {
            return <View key={i} style={styles.calCell} />;
          }
          const iso = dateInMonth(month, d);
          const isSel = iso === selected;
          const isToday = iso === t;
          return (
            <TouchableOpacity key={i} style={styles.calCell} onPress={() => onPick(iso)} activeOpacity={0.7}>
              <View style={[styles.calDay, isToday && !isSel && styles.calToday, isSel && styles.calSel]}>
                <Text style={[styles.calDayText, isSel && { color: '#04201a', fontWeight: '800' }, isToday && !isSel && { color: theme.green }]}>{d}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <Button title="Today" small kind="ghost" onPress={() => onPick(t)} />
        <Button title="Tomorrow" small kind="ghost" onPress={() => onPick(addDaysISO(t, 1))} style={{ marginLeft: 8 }} />
        <Button title="Next month" small kind="ghost" onPress={() => onPick(addMonthKey(t.slice(0, 7), 1) + t.slice(7))} style={{ marginLeft: 8 }} />
      </View>
    </Sheet>
  );
};

// ---------------------------------------------------------------- TimePicker ---
export const TimePickerField: FC<{
  label: string;
  value: string; // HH:mm or ''
  onChange: (hhmm: string) => void;
  hint?: string;
}> = ({ label, value, onChange, hint }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PickerButton
        label={label}
        text={value ? formatTime12(value) : undefined}
        placeholder="Optional"
        icon="clock"
        onPress={() => setOpen(true)}
        onClear={() => onChange('')}
        hint={hint}
      />
      <TimeSheet
        visible={open}
        value={value}
        onClose={() => setOpen(false)}
        onPick={hhmm => {
          onChange(hhmm);
          setOpen(false);
        }}
      />
    </>
  );
};

const Stepper: FC<{ value: string; onUp: () => void; onDown: () => void; caption: string }> = ({ value, onUp, onDown, caption }) => (
  <View style={{ alignItems: 'center', flex: 1 }}>
    <Text style={styles.stepCaption}>{caption}</Text>
    <TouchableOpacity onPress={onUp} style={styles.stepBtn} hitSlop={8}>
      <Icon name="chevron-left" size={22} color={theme.text} />
    </TouchableOpacity>
    <Text style={styles.stepValue}>{value}</Text>
    <TouchableOpacity onPress={onDown} style={styles.stepBtn} hitSlop={8}>
      <Icon name="chevron-right" size={22} color={theme.text} />
    </TouchableOpacity>
  </View>
);

const TimeSheet: FC<{ visible: boolean; value: string; onClose: () => void; onPick: (hhmm: string) => void }> = ({
  visible,
  value,
  onClose,
  onPick,
}) => {
  const [h24, setH24] = useState(9);
  const [min, setMin] = useState(0);
  useEffect(() => {
    if (visible) {
      const [h, mm] = (value || '09:00').split(':').map(Number);
      setH24(h);
      setMin(mm - (mm % 5));
    }
  }, [visible, value]);
  const pm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const setH12 = (h: number) => setH24((h % 12) + (pm ? 12 : 0));

  return (
    <Sheet visible={visible} title="Select time" onClose={onClose}>
      <Text style={styles.bigTime}>{formatTime12(`${pad(h24)}:${pad(min)}`)}</Text>
      <View style={{ flexDirection: 'row', marginVertical: 8 }}>
        <Stepper caption="Hour" value={String(h12)} onUp={() => setH12(h12 === 12 ? 1 : h12 + 1)} onDown={() => setH12(h12 === 1 ? 12 : h12 - 1)} />
        <Stepper caption="Minute" value={pad(min)} onUp={() => setMin((min + 5) % 60)} onDown={() => setMin((min + 55) % 60)} />
      </View>
      <Segmented
        options={[
          { value: 'am', label: 'AM' },
          { value: 'pm', label: 'PM' },
        ]}
        value={pm ? 'pm' : 'am'}
        onChange={v => setH24((h24 % 12) + (v === 'pm' ? 12 : 0))}
      />
      <View style={{ flexDirection: 'row', marginTop: 16 }}>
        <Button title="Set time" onPress={() => onPick(`${pad(h24)}:${pad(min)}`)} style={{ flex: 1 }} />
        <Button title="No time" kind="ghost" onPress={() => onPick('')} style={{ marginLeft: 8 }} />
      </View>
    </Sheet>
  );
};

// ----------------------------------------------------------------- BankPicker ---
/** Sheet to add a bank account: its name and the balance today. */
export const AddBankSheet: FC<{ visible: boolean; onClose: () => void; onAdded?: (bankId: string) => void }> = ({ visible, onClose, onAdded }) => {
  const { db, actions } = useStore();
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  useEffect(() => {
    if (visible) {
      setName('');
      setBalance('');
    }
  }, [visible]);

  const save = () => {
    if (!name.trim()) {
      Alert.alert('Bank name', 'Enter the bank name.');
      return;
    }
    const bank = actions.addBank(name, Number(balance) || 0);
    onAdded?.(bank.id);
    onClose();
  };

  return (
    <Sheet visible={visible} title="Add bank account" onClose={onClose}>
      <Field label="Bank name" value={name} onChangeText={setName} placeholder="ICICI, SBI, HDFC…" autoCapitalize="words" />
      <Field
        label={`Current balance (${db.settings.currency})`}
        value={balance}
        onChangeText={setBalance}
        keyboardType="decimal-pad"
        placeholder="0"
        hint="Your balance today. Later payments and transactions update it."
      />
      <Button title="Save bank" onPress={save} />
    </Sheet>
  );
};

/** Choose one of your bank accounts, or add a new one right here. */
export const BankPicker: FC<{
  label?: string;
  value?: string;
  onChange: (bankId: string | undefined) => void;
  /** Mandatory: hides the "None" choice. */
  required?: boolean;
  hint?: string;
}> = ({ label = 'Bank', value, onChange, required, hint }) => {
  const { db } = useStore();
  const [adding, setAdding] = useState(false);

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={{ color: theme.danger }}> *</Text> : null}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!required && (
          <TouchableOpacity onPress={() => onChange(undefined)} style={[styles.chip, !value && styles.chipOn]}>
            <Text style={[styles.chipText, !value && { color: '#fff' }]}>None</Text>
          </TouchableOpacity>
        )}
        {db.banks.map(b => (
          <TouchableOpacity key={b.id} onPress={() => onChange(b.id)} style={[styles.chip, value === b.id && styles.chipOn]}>
            <Icon name="bank" size={14} color={value === b.id ? '#fff' : theme.mute} />
            <Text style={[styles.chipText, { marginLeft: 6 }, value === b.id && { color: '#fff' }]}>{b.name}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={() => setAdding(true)} style={[styles.chip, styles.chipAdd]}>
          <Icon name="plus" size={14} color={theme.green} strokeWidth={2.6} />
          <Text style={[styles.chipText, { color: theme.green, marginLeft: 4 }]}>Add bank</Text>
        </TouchableOpacity>
      </ScrollView>
      {db.banks.length === 0 && <Text style={styles.hint}>No bank accounts yet. Add one to link this payment.</Text>}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <AddBankSheet visible={adding} onClose={() => setAdding(false)} onAdded={id => onChange(id)} />
    </View>
  );
};

const styles = StyleSheet.create({
  label: { color: theme.mute, fontSize: 12, marginBottom: 5, fontWeight: '600' },
  hint: { color: theme.dim, fontSize: 11, marginTop: 4 },
  segWrap: { flexDirection: 'row', backgroundColor: theme.cardSoft, borderRadius: 14, padding: 4, borderWidth: 1, borderColor: theme.line },
  segThumb: { position: 'absolute', top: 4, left: 4, bottom: 4, borderRadius: 11, backgroundColor: theme.green },
  segItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  segText: { color: theme.mute, fontWeight: '700', fontSize: 14 },
  pickBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.cardSoft, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: theme.line },
  pickText: { flex: 1, color: theme.text, fontSize: 15, marginLeft: 10 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  calNav: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.cardSoft, alignItems: 'center', justifyContent: 'center' },
  calTitle: { color: theme.text, fontSize: 17, fontWeight: '800' },
  calRow: { flexDirection: 'row' },
  calWeek: { flex: 1, textAlign: 'center', color: theme.dim, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calDay: { width: '84%', height: '84%', borderRadius: 100, alignItems: 'center', justifyContent: 'center' },
  calToday: { borderWidth: 1.5, borderColor: theme.green },
  calSel: { backgroundColor: theme.green },
  calDayText: { color: theme.text, fontSize: 15 },
  bigTime: { color: theme.green, fontSize: 40, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  stepCaption: { color: theme.dim, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.cardSoft, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '90deg' }] },
  stepValue: { color: theme.text, fontSize: 30, fontWeight: '800', marginVertical: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: theme.line, marginRight: 8, backgroundColor: theme.cardSoft },
  chipOn: { backgroundColor: theme.blue, borderColor: theme.blue },
  chipAdd: { borderStyle: 'dashed', borderColor: 'rgba(61,220,151,0.5)', backgroundColor: 'transparent' },
  chipText: { color: theme.mute, fontSize: 13, fontWeight: '600' },
});
