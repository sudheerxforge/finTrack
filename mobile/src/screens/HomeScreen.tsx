import React, { FC } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useStore } from '../state/store';
import { Badge, Card, ProgressBar } from '../components/ui';
import { CountUp, Reveal } from '../components/anim';
import Icon from '../components/Icon';
import { theme } from '../theme';
import { TabKey } from '../navigation';
import { formatMoney } from '../utils/money';
import { availableMoney, bankName } from '../utils/banks';
import { monthKey, monthLabelLong, shortDateOrd, today } from '../utils/dates';
import { monthTotals, upcomingPayments } from '../utils/summary';
import { monthBillSummary } from '../utils/bills';
import { daysBetween } from '../utils/dates';

const SectionHead: FC<{ title: string; action?: string; onAction?: () => void }> = ({ title, action, onAction }) => (
  <View style={styles.sectionHead}>
    <Text style={styles.section}>{title}</Text>
    {action && onAction ? (
      <TouchableOpacity onPress={onAction} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={styles.action}>{action}</Text>
        <Icon name="chevron-right" size={16} color={theme.green} />
      </TouchableOpacity>
    ) : null}
  </View>
);

/** Four things only: money available, what to pay next, this month's transactions, and bills paid. */
const HomeScreen: FC<{ onGo: (tab: TabKey) => void }> = ({ onGo }) => {
  const { db } = useStore();
  const cur = db.settings.currency;
  const t = today();
  const month = monthKey(t);

  const available = availableMoney(db);
  const upcoming = upcomingPayments(db, t);
  const totals = monthTotals(db, month);
  const bills = monthBillSummary(db, month, t);
  const recent = [...db.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 3);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* ------------------------------------------------ available money --- */}
      <Reveal>
        <Card style={styles.hero} onPress={() => onGo('activity')}>
          <View style={styles.between}>
            <Text style={styles.heroCaption}>Available money</Text>
            <Icon name="wallet" size={20} color="rgba(255,255,255,0.8)" />
          </View>
          <CountUp value={available} format={v => formatMoney(Math.round(v * 100) / 100, cur)} style={styles.heroValue} />
          <Text style={styles.heroCaption}>
            {db.banks.length === 0 ? 'Add your bank accounts in Activity' : `Across ${db.banks.length} bank account${db.banks.length === 1 ? '' : 's'}`}
          </Text>
        </Card>
      </Reveal>

      {/* ----------------------------------------------- upcoming payments --- */}
      <Reveal delay={90}>
        <SectionHead title="Upcoming payments" action={upcoming.length ? 'All bills' : 'Add bills'} onAction={() => onGo('bills')} />
        <Card>
          {upcoming.length === 0 && <Text style={styles.muted}>Nothing to pay. Add your monthly bills and they show up here.</Text>}
          {upcoming.slice(0, 5).map((d, i) => {
            const days = daysBetween(t, d.date);
            const color = d.overdue ? theme.danger : days <= 3 ? theme.amber : theme.mute;
            const when = d.overdue ? `Overdue ${-days}d` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
            return (
              <View key={d.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {d.title}
                  </Text>
                  <Text style={[styles.small, { color }]}>
                    {when} · {shortDateOrd(d.date)}
                    {d.autoDebit ? ` · Auto${d.bank ? ` (${d.bank})` : ''}` : ''}
                  </Text>
                </View>
                {d.amount ? <Text style={styles.amount}>{formatMoney(d.amount, cur)}</Text> : <Badge text="NO AMOUNT" color={theme.mute} />}
              </View>
            );
          })}
          {upcoming.length > 5 && <Text style={[styles.small, { marginTop: 10 }]}>+ {upcoming.length - 5} more</Text>}
        </Card>
      </Reveal>

      {/* ------------------------------------------------------ transactions --- */}
      <Reveal delay={180}>
        <SectionHead title="Transactions" action="See all" onAction={() => onGo('activity')} />
        <Card>
          <Text style={styles.small}>{monthLabelLong(month)}</Text>
          <View style={[styles.between, { marginTop: 8 }]}>
            <View style={styles.tile}>
              <View style={styles.tileHead}>
                <Icon name="arrow-down" size={14} color={theme.green} strokeWidth={2.6} />
                <Text style={[styles.tileLabel, { color: theme.green }]}>Credits</Text>
              </View>
              <Text style={styles.tileValue}>{formatMoney(totals.credits, cur)}</Text>
            </View>
            <View style={{ width: 10 }} />
            <View style={styles.tile}>
              <View style={styles.tileHead}>
                <Icon name="arrow-up" size={14} color={theme.red} strokeWidth={2.6} />
                <Text style={[styles.tileLabel, { color: theme.red }]}>Debits</Text>
              </View>
              <Text style={styles.tileValue}>{formatMoney(totals.debits, cur)}</Text>
            </View>
          </View>
          {recent.map((r, i) => (
            <View key={r.id} style={[styles.row, styles.rowBorder, i === 0 && { marginTop: 12 }]}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {r.note || r.category}
                </Text>
                <Text style={styles.small} numberOfLines={1}>
                  {shortDateOrd(r.date)}
                  {bankName(db, r.bankId) ? ` · ${bankName(db, r.bankId)}` : ''}
                </Text>
              </View>
              <Text style={[styles.amount, { color: r.kind === 'credit' ? theme.green : theme.text }]}>
                {r.kind === 'credit' ? '+' : '-'}
                {formatMoney(r.amount, cur)}
              </Text>
            </View>
          ))}
          {recent.length === 0 && <Text style={[styles.muted, { marginTop: 12 }]}>No transactions yet.</Text>}
        </Card>
      </Reveal>

      {/* --------------------------------------------------------- spends --- */}
      <Reveal delay={270}>
        <SectionHead title="Spends" action="Details" onAction={() => onGo('spends')} />
        <Card onPress={() => onGo('spends')}>
          <Text style={styles.small}>Bills paid in {monthLabelLong(month)}</Text>
          <CountUp value={bills.paid} format={v => formatMoney(Math.round(v * 100) / 100, cur)} style={styles.spend} />
          <View style={{ marginTop: 6 }}>
            <ProgressBar value={bills.total ? bills.paid / bills.total : 0} color={theme.green} />
          </View>
          <Text style={[styles.small, { marginTop: 8 }]}>
            {bills.paidCount} of {bills.count} bills paid
            {bills.remaining > 0 ? ` · ${formatMoney(bills.remaining, cur)} left` : ''}
          </Text>
        </Card>
      </Reveal>
    </ScrollView>
  );
};

export default HomeScreen;

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hero: { backgroundColor: theme.blue },
  heroCaption: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  heroValue: { color: '#fff', fontSize: 38, fontWeight: '800', marginVertical: 4 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 10 },
  section: { color: theme.text, fontSize: 17, fontWeight: '800' },
  action: { color: theme.green, fontSize: 13, fontWeight: '700' },
  muted: { color: theme.dim, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
  name: { color: theme.text, fontSize: 15, fontWeight: '600' },
  small: { color: theme.dim, fontSize: 12, marginTop: 2 },
  amount: { color: theme.text, fontSize: 15, fontWeight: '700' },
  tile: { flex: 1, backgroundColor: theme.cardSoft, borderRadius: 14, padding: 12 },
  tileHead: { flexDirection: 'row', alignItems: 'center' },
  tileLabel: { fontSize: 12, fontWeight: '700', marginLeft: 5 },
  tileValue: { color: theme.text, fontSize: 18, fontWeight: '800', marginTop: 6 },
  spend: { color: theme.text, fontSize: 28, fontWeight: '800', marginTop: 4 },
});
