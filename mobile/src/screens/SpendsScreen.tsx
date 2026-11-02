import React, { FC, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useStore } from '../state/store';
import { Card, Empty, ProgressBar } from '../components/ui';
import { CountUp, Reveal } from '../components/anim';
import Icon from '../components/Icon';
import { theme } from '../theme';
import { billPaymentsInMonth, billDisplayName, maskedPhone, isRechargeType, monthBillSummary } from '../utils/bills';
import { bankName } from '../utils/banks';
import { formatMoney, round2 } from '../utils/money';
import { addMonthKey, monthKey, monthLabelLong, shortDateOrd, today } from '../utils/dates';

/** Bills paid in a month: how much, on what, and when. */
const SpendsScreen: FC = () => {
  const { db } = useStore();
  const cur = db.settings.currency;
  const thisMonth = monthKey(today());
  const [month, setMonth] = useState(thisMonth);

  const payments = useMemo(() => billPaymentsInMonth(db, month), [db, month]);
  const total = round2(payments.reduce((s, r) => s + r.payment.amount, 0));
  const summary = monthBillSummary(db, month, today());

  // Spending per bill tab.
  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of payments) {
      const name = r.type?.name ?? 'Other';
      map.set(name, (map.get(name) ?? 0) + r.payment.amount);
    }
    return [...map.entries()].map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => b.amount - a.amount);
  }, [payments]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={styles.monthRow}>
        <TouchableOpacity onPress={() => setMonth(addMonthKey(month, -1))} hitSlop={12} style={styles.nav}>
          <Icon name="chevron-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.monthText}>{monthLabelLong(month)}</Text>
        <TouchableOpacity onPress={() => setMonth(addMonthKey(month, 1))} hitSlop={12} style={[styles.nav, month >= thisMonth && { opacity: 0.3 }]} disabled={month >= thisMonth}>
          <Icon name="chevron-right" size={22} color={theme.text} />
        </TouchableOpacity>
      </View>

      <Reveal key={month} distance={10}>
        <Card>
          <Text style={styles.caption}>Bills paid {month === thisMonth ? 'this month' : 'in this month'}</Text>
          <CountUp value={total} format={v => formatMoney(Math.round(v * 100) / 100, cur)} style={styles.big} />
          <Text style={styles.caption}>
            {payments.length} payment{payments.length === 1 ? '' : 's'}
            {month === thisMonth && summary.remaining > 0 ? ` · ${formatMoney(summary.remaining, cur)} still to pay` : ''}
          </Text>
        </Card>
      </Reveal>

      {byType.length > 0 && (
        <>
          <Text style={styles.section}>Where it went</Text>
          <Card>
            {byType.map(t => (
              <View key={t.name} style={{ marginBottom: 12 }}>
                <View style={styles.between}>
                  <Text style={styles.name}>{t.name}</Text>
                  <Text style={styles.name}>{formatMoney(t.amount, cur)}</Text>
                </View>
                <View style={{ marginTop: 5 }}>
                  <ProgressBar value={total ? t.amount / total : 0} color={theme.blue} />
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      <Text style={styles.section}>Payments</Text>
      {payments.length === 0 ? (
        <Empty text={'No bills paid in this month yet.\nMark a bill as paid on the Monthly Bills tab and it shows up here.'} />
      ) : (
        payments.map(({ bill, type, payment }) => (
          <View key={payment.id} style={styles.row}>
            <View style={styles.dot}>
              <Icon name="check" size={18} color={theme.green} strokeWidth={2.6} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {isRechargeType(type) ? maskedPhone(bill) : billDisplayName(bill, type)}
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                {type?.name} · {shortDateOrd(payment.date)}
                {bankName(db, payment.bankId) ? ` · ${bankName(db, payment.bankId)}` : ''}
              </Text>
            </View>
            <Text style={styles.amount}>{formatMoney(payment.amount, cur)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
};

export default SpendsScreen;

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  nav: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  monthText: { color: theme.text, fontSize: 18, fontWeight: '800' },
  caption: { color: theme.mute, fontSize: 12 },
  big: { color: theme.text, fontSize: 32, fontWeight: '800', marginVertical: 3 },
  section: { color: theme.text, fontSize: 16, fontWeight: '800', marginTop: 16, marginBottom: 10 },
  name: { color: theme.text, fontSize: 15, fontWeight: '600' },
  small: { color: theme.dim, fontSize: 12, marginTop: 2 },
  amount: { color: theme.text, fontSize: 15, fontWeight: '700', marginLeft: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 14, padding: 12, marginBottom: 8 },
  dot: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(61,220,151,0.14)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
});
