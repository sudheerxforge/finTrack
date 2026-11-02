import React, { FC, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useStore } from '../state/store';
import { Badge, Button, Card, Empty, Fab, Field, Sheet } from '../components/ui';
import { BankPicker, DatePickerField, Segmented } from '../components/pickers';
import { Reveal } from '../components/anim';
import Icon from '../components/Icon';
import { theme } from '../theme';
import { InterestDebt } from '../types';
import { interestStatus, rateLabel } from '../utils/interest';
import { bankName } from '../utils/banks';
import { formatMoney, round2 } from '../utils/money';
import { prettyDateOrd, today } from '../utils/dates';

type Tab = 'lend' | 'borrow';

const InterestScreen: FC = () => {
  const { db } = useStore();
  const cur = db.settings.currency;
  const [tab, setTab] = useState<Tab>('lend');
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const t = today();

  const list = useMemo(() => db.interestDebts.filter(d => d.direction === tab), [db.interestDebts, tab]);
  const totals = useMemo(() => {
    let principal = 0;
    let interest = 0;
    for (const d of list) {
      const s = interestStatus(d, t);
      principal += s.principalLeft;
      interest += s.interestDue;
    }
    return { principal: round2(principal), interest: round2(interest) };
  }, [list, t]);
  const detail = db.interestDebts.find(d => d.id === detailId) ?? null;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
        <Segmented
          options={[
            { value: 'lend', label: 'Lends', icon: 'arrow-up' },
            { value: 'borrow', label: 'Borrow', icon: 'arrow-down' },
          ]}
          value={tab}
          onChange={setTab}
        />

        <Reveal key={tab} distance={10}>
          <Card style={{ marginTop: 14 }}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.caption}>{tab === 'lend' ? 'Principal out' : 'Principal owed'}</Text>
                <Text style={styles.big}>{formatMoney(totals.principal, cur)}</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={styles.caption}>{tab === 'lend' ? 'Interest to receive' : 'Interest to pay'}</Text>
                <Text style={[styles.big, { color: tab === 'lend' ? theme.green : theme.red }]}>{formatMoney(totals.interest, cur)}</Text>
              </View>
            </View>
            <Text style={styles.caption}>Simple interest, up to today</Text>
          </Card>
        </Reveal>

        {list.length === 0 ? (
          <Empty text={tab === 'lend' ? 'No interest-bearing loans given.\nTap + to add money you lent with interest.' : 'No interest-bearing loans taken.\nTap + to add money you borrowed with interest.'} />
        ) : (
          list.map((d, i) => (
            <Reveal key={d.id} delay={Math.min(i, 6) * 50} distance={10}>
              <InterestCard d={d} cur={cur} onPress={() => setDetailId(d.id)} />
            </Reveal>
          ))
        )}
      </ScrollView>

      <Fab onPress={() => setFormOpen(true)} />
      <InterestForm visible={formOpen} direction={tab} onClose={() => setFormOpen(false)} />
      <InterestDetail debt={detail} onClose={() => setDetailId(null)} />
    </View>
  );
};

const InterestCard: FC<{ d: InterestDebt; cur: string; onPress: () => void }> = ({ d, cur, onPress }) => {
  const s = interestStatus(d, today());
  const lend = d.direction === 'lend';
  const closed = s.principalLeft <= 0 && s.interestDue <= 0;
  return (
    <Card onPress={onPress} style={closed ? { opacity: 0.55 } : undefined}>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{d.person}</Text>
          <Text style={styles.small}>
            {formatMoney(d.principal, cur)} · {rateLabel(d)}
          </Text>
        </View>
        {closed ? <Badge text="CLEARED" color={theme.green} /> : <Badge text={lend ? 'LENT' : 'BORROWED'} color={lend ? theme.green : theme.red} />}
      </View>
      <View style={[styles.between, { marginTop: 12 }]}>
        <View>
          <Text style={styles.small}>Principal left</Text>
          <Text style={styles.value}>{formatMoney(s.principalLeft, cur)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.small}>Interest due</Text>
          <Text style={[styles.value, { color: s.interestDue > 0 ? theme.amber : theme.text }]}>{formatMoney(s.interestDue, cur)}</Text>
        </View>
      </View>
      <Text style={[styles.small, { marginTop: 8 }]}>Since {prettyDateOrd(d.startDate)}</Text>
    </Card>
  );
};

// ------------------------------------------------------------------- form ---
const InterestForm: FC<{ visible: boolean; direction: Tab; onClose: () => void }> = ({ visible, direction, onClose }) => {
  const { db, actions } = useStore();
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [per, setPer] = useState<InterestDebt['per']>('month');
  const [start, setStart] = useState(today());
  const [note, setNote] = useState('');
  const lend = direction === 'lend';

  useEffect(() => {
    if (visible) {
      setPerson('');
      setAmount('');
      setRate('');
      setPer('month');
      setStart(today());
      setNote('');
    }
  }, [visible]);

  const save = () => {
    const principal = Number(amount);
    const r = Number(rate);
    if (!person.trim() || !(principal > 0)) {
      return Alert.alert('Missing info', 'Enter the person and an amount greater than 0.');
    }
    if (!(r > 0)) {
      return Alert.alert('Interest rate', 'Enter the interest rate, for example 2.');
    }
    if (!start) {
      return Alert.alert('Start date', 'Choose the date the money was given.');
    }
    actions.addInterestDebt({ direction, person, principal, rate: r, per, startDate: start, note });
    onClose();
  };

  return (
    <Sheet visible={visible} title={lend ? 'New lend with interest' : 'New borrow with interest'} onClose={onClose}>
      <Field label={lend ? 'Lent to' : 'Borrowed from'} value={person} onChangeText={setPerson} placeholder="Name" autoCapitalize="words" />
      <Field label={`Principal (${db.settings.currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
      <Field label="Interest rate (%)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="e.g. 2" />
      <Text style={styles.label}>Rate is charged</Text>
      <Segmented
        options={[
          { value: 'month', label: 'Per month' },
          { value: 'year', label: 'Per year' },
        ]}
        value={per}
        onChange={setPer}
      />
      <View style={{ height: 12 }} />
      <DatePickerField label="Start date *" value={start} onChange={setStart} />
      <Field label="Note" value={note} onChangeText={setNote} multiline />
      <Button title="Save" onPress={save} />
    </Sheet>
  );
};

// ----------------------------------------------------------------- detail ---
const InterestDetail: FC<{ debt: InterestDebt | null; onClose: () => void }> = ({ debt, onClose }) => {
  const { db, actions } = useStore();
  const cur = db.settings.currency;
  const [kind, setKind] = useState<'interest' | 'principal'>('interest');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [bankId, setBankId] = useState<string | undefined>();

  useEffect(() => {
    setKind('interest');
    setAmount('');
    setDate(today());
    setBankId(undefined);
  }, [debt?.id]);

  if (!debt) {
    return <Sheet visible={false} title="" onClose={onClose}>{null}</Sheet>;
  }
  const s = interestStatus(debt, today());
  const lend = debt.direction === 'lend';

  const record = () => {
    const n = Number(amount);
    if (!(n > 0)) {
      return Alert.alert('Amount needed', 'Enter an amount greater than 0.');
    }
    if (kind === 'principal' && n > s.principalLeft + 0.005) {
      return Alert.alert('Too much', `Only ${formatMoney(s.principalLeft, cur)} of the principal is left.`);
    }
    actions.addInterestPayment(debt.id, kind, n, date || today(), bankId);
    setAmount('');
  };

  const remove = () =>
    Alert.alert('Delete this record?', 'Its payments and the transactions they created will be removed too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          actions.deleteInterestDebt(debt.id);
          onClose();
        },
      },
    ]);

  const rows: Array<[string, string]> = [
    ['Principal', formatMoney(debt.principal, cur)],
    ['Rate', rateLabel(debt)],
    ['Since', prettyDateOrd(debt.startDate)],
    ['Principal left', formatMoney(s.principalLeft, cur)],
    ['Interest so far', formatMoney(s.accrued, cur)],
    ['Interest paid', formatMoney(s.interestPaid, cur)],
    ['Interest each month now', formatMoney(s.perMonth, cur)],
  ];

  return (
    <Sheet visible title={debt.person} onClose={onClose}>
      <Text style={styles.small}>{lend ? 'You lent' : 'You borrowed'}</Text>
      <Text style={[styles.big, { color: lend ? theme.green : theme.red }]}>{formatMoney(s.totalOutstanding, cur)}</Text>
      <Text style={[styles.small, { marginBottom: 8 }]}>
        in total: {formatMoney(s.principalLeft, cur)} principal + {formatMoney(s.interestDue, cur)} interest due
      </Text>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.kv}>
          <Text style={styles.small}>{k}</Text>
          <Text style={styles.kvValue}>{v}</Text>
        </View>
      ))}

      <Text style={[styles.name, { marginTop: 20, marginBottom: 8 }]}>{lend ? 'Record money received' : 'Record money paid'}</Text>
      <Segmented
        options={[
          { value: 'interest', label: 'Interest' },
          { value: 'principal', label: 'Principal' },
        ]}
        value={kind}
        onChange={setKind}
      />
      <View style={{ height: 12 }} />
      <Field label={`Amount (${cur})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
      {kind === 'interest' && s.interestDue > 0 && (
        <Button title={`Fill interest due (${formatMoney(s.interestDue, cur)})`} small kind="ghost" onPress={() => setAmount(String(s.interestDue))} style={{ alignSelf: 'flex-start', marginBottom: 12 }} />
      )}
      <DatePickerField label="Date" value={date} onChange={setDate} />
      <BankPicker label={lend ? 'Received in (optional)' : 'Paid from (optional)'} value={bankId} onChange={setBankId} />
      <Button title="Record" icon="check" onPress={record} />

      <Text style={[styles.name, { marginTop: 20, marginBottom: 8 }]}>History</Text>
      {debt.payments.length === 0 && <Text style={styles.small}>No payments yet.</Text>}
      {[...debt.payments]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(p => (
          <View key={p.id} style={[styles.between, styles.pay]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kvValue}>
                {formatMoney(p.amount, cur)} <Text style={{ color: theme.dim, fontWeight: '500' }}>· {p.kind}</Text>
              </Text>
              <Text style={styles.small}>
                {prettyDateOrd(p.date)}
                {bankName(db, p.bankId) ? ` · ${bankName(db, p.bankId)}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => actions.deleteInterestPayment(debt.id, p.id)} hitSlop={10}>
              <Icon name="trash" size={18} color={theme.danger} />
            </TouchableOpacity>
          </View>
        ))}
      <Button title="Delete record" kind="danger" icon="trash" onPress={remove} style={{ marginTop: 20 }} />
    </Sheet>
  );
};

export default InterestScreen;

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caption: { color: theme.mute, fontSize: 12 },
  big: { color: theme.text, fontSize: 26, fontWeight: '800', marginVertical: 3 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  small: { color: theme.dim, fontSize: 12 },
  value: { color: theme.text, fontSize: 16, fontWeight: '800', marginTop: 2 },
  label: { color: theme.mute, fontSize: 12, marginBottom: 5, fontWeight: '600' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  kvValue: { color: theme.text, fontWeight: '600', fontSize: 14 },
  pay: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
});
