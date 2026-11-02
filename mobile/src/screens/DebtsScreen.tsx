import React, { FC, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useStore } from '../state/store';
import { Badge, Button, Card, Empty, Fab, Field, ProgressBar, Sheet } from '../components/ui';
import { BankPicker, DatePickerField, Segmented } from '../components/pickers';
import { Reveal } from '../components/anim';
import Icon from '../components/Icon';
import { theme } from '../theme';
import { debtOutstanding, debtPaid, debtSettled, formatMoney } from '../utils/money';
import { bankName } from '../utils/banks';
import { prettyDateOrd, relativeDue, today } from '../utils/dates';
import { Debt } from '../types';

type Tab = 'lends' | 'borrow';
const DIRECTION: Record<Tab, Debt['direction']> = { lends: 'owed', borrow: 'owe' };

const DebtsScreen: FC = () => {
  const { db } = useStore();
  const cur = db.settings.currency;
  const [tab, setTab] = useState<Tab>('lends');
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const direction = DIRECTION[tab];
  const list = useMemo(
    () =>
      db.debts
        .filter(d => d.direction === direction)
        .sort((a, b) => Number(debtSettled(a)) - Number(debtSettled(b)) || b.createdAt - a.createdAt),
    [db.debts, direction],
  );
  const open = list.filter(d => !debtSettled(d));
  const total = open.reduce((s, d) => s + debtOutstanding(d), 0);
  const detail = db.debts.find(d => d.id === detailId) ?? null;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
        <Segmented
          options={[
            { value: 'lends', label: 'Lends', icon: 'arrow-up' },
            { value: 'borrow', label: 'Borrow', icon: 'arrow-down' },
          ]}
          value={tab}
          onChange={setTab}
        />

        <Reveal key={tab} distance={10}>
          <Card style={{ marginTop: 14 }}>
            <Text style={styles.caption}>{tab === 'lends' ? 'You will get back' : 'You have to repay'}</Text>
            <Text style={[styles.big, { color: tab === 'lends' ? theme.green : theme.red }]}>{formatMoney(total, cur)}</Text>
            <Text style={styles.caption}>
              {open.length === 0 ? 'Nothing pending' : `${open.length} ${open.length === 1 ? 'person' : 'people'}`}
              {tab === 'lends' ? ' · money you lent' : ' · money you borrowed'}
            </Text>
          </Card>
        </Reveal>

        {list.length === 0 ? (
          <Empty text={tab === 'lends' ? 'Nobody owes you money.\nTap + when you lend someone money.' : "You haven't borrowed anything.\nTap + when you borrow money."} />
        ) : (
          list.map((d, i) => (
            <Reveal key={d.id} delay={Math.min(i, 6) * 50} distance={10}>
              <DebtCard d={d} cur={cur} onPress={() => setDetailId(d.id)} />
            </Reveal>
          ))
        )}
      </ScrollView>

      <Fab onPress={() => setFormOpen(true)} />
      <DebtForm visible={formOpen} direction={direction} onClose={() => setFormOpen(false)} />
      <DebtDetail debt={detail} onClose={() => setDetailId(null)} />
    </View>
  );
};

const DebtCard: FC<{ d: Debt; cur: string; onPress: () => void }> = ({ d, cur, onPress }) => {
  const out = debtOutstanding(d);
  const settled = debtSettled(d);
  const overdue = !!d.dueDate && !settled && d.dueDate < today();
  const lend = d.direction === 'owed';
  return (
    <Card onPress={onPress} style={settled ? { opacity: 0.55 } : undefined}>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{d.person}</Text>
          <Text style={styles.small}>{lend ? 'Owes you' : 'You owe'}</Text>
        </View>
        {settled ? <Badge text="SETTLED" color={theme.green} /> : <Text style={[styles.amount, { color: lend ? theme.green : theme.red }]}>{formatMoney(out, cur)}</Text>}
      </View>
      <View style={{ marginTop: 12 }}>
        <ProgressBar value={d.principal ? debtPaid(d) / d.principal : 0} color={lend ? theme.green : theme.blue} />
        <View style={[styles.between, { marginTop: 6 }]}>
          <Text style={styles.small}>
            {lend ? 'Received' : 'Paid'} {formatMoney(debtPaid(d), cur)} of {formatMoney(d.principal, cur)}
          </Text>
          {d.dueDate && !settled && <Text style={[styles.small, overdue && { color: theme.danger, fontWeight: '700' }]}>{relativeDue(d.dueDate)}</Text>}
        </View>
      </View>
    </Card>
  );
};

// ------------------------------------------------------------------- form ---
const DebtForm: FC<{ visible: boolean; direction: Debt['direction']; onClose: () => void }> = ({ visible, direction, onClose }) => {
  const { db, actions } = useStore();
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const lend = direction === 'owed';

  useEffect(() => {
    if (visible) {
      setPerson('');
      setAmount('');
      setDue('');
      setNote('');
    }
  }, [visible]);

  const save = () => {
    const n = Number(amount);
    if (!person.trim() || !(n > 0)) {
      return Alert.alert('Missing info', 'Enter the person and an amount greater than 0.');
    }
    actions.addDebt({ direction, person, principal: n, dueDate: due || undefined, note });
    onClose();
  };

  return (
    <Sheet visible={visible} title={lend ? 'New lend' : 'New borrow'} onClose={onClose}>
      <Text style={[styles.small, { marginBottom: 12 }]}>{lend ? 'Money you gave someone, to get back later.' : 'Money you took from someone, to repay later.'}</Text>
      <Field label={lend ? 'Lent to' : 'Borrowed from'} value={person} onChangeText={setPerson} placeholder="Name" autoCapitalize="words" />
      <Field label={`Amount (${db.settings.currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
      <DatePickerField label="Due date (optional)" value={due} onChange={setDue} allowClear placeholder="No due date" hint="You'll get a reminder before this date." />
      <Field label="Note" value={note} onChangeText={setNote} multiline />
      <Button title={lend ? 'Save lend' : 'Save borrow'} onPress={save} />
    </Sheet>
  );
};

// ----------------------------------------------------------------- detail ---
const DebtDetail: FC<{ debt: Debt | null; onClose: () => void }> = ({ debt, onClose }) => {
  const { db, actions } = useStore();
  const cur = db.settings.currency;
  const [amount, setAmount] = useState('');
  const [bankId, setBankId] = useState<string | undefined>();

  useEffect(() => {
    setAmount('');
    setBankId(undefined);
  }, [debt?.id]);

  if (!debt) {
    return <Sheet visible={false} title="" onClose={onClose}>{null}</Sheet>;
  }
  const lend = debt.direction === 'owed';
  const out = debtOutstanding(debt);

  const pay = (full: boolean) => {
    const n = full ? out : Number(amount);
    if (!(n > 0)) {
      return Alert.alert('Amount needed', 'Enter an amount greater than 0.');
    }
    if (n > out + 0.005) {
      return Alert.alert('Too much', `Only ${formatMoney(out, cur)} is outstanding.`);
    }
    actions.addDebtPayment(debt.id, n, today(), '', bankId);
    setAmount('');
  };

  const remove = () =>
    Alert.alert('Delete this record?', 'Its payments and the transactions they created will be removed too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          actions.deleteDebt(debt.id);
          onClose();
        },
      },
    ]);

  return (
    <Sheet visible title={debt.person} onClose={onClose}>
      <Text style={styles.small}>
        {lend ? 'You lent' : 'You borrowed'} {formatMoney(debt.principal, cur)}
      </Text>
      <Text style={[styles.big, { color: debtSettled(debt) ? theme.green : lend ? theme.green : theme.red }]}>
        {debtSettled(debt) ? 'Settled' : `${formatMoney(out, cur)} left`}
      </Text>
      {debt.dueDate && (
        <Text style={styles.small}>
          Due {prettyDateOrd(debt.dueDate)} · {relativeDue(debt.dueDate)}
        </Text>
      )}
      {!!debt.note && <Text style={[styles.small, { marginTop: 6 }]}>{debt.note}</Text>}

      {!debtSettled(debt) && (
        <View style={{ marginTop: 16 }}>
          <Field label={lend ? 'Amount received' : 'Repayment amount'} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
          <BankPicker label={lend ? 'Received in (optional)' : 'Paid from (optional)'} value={bankId} onChange={setBankId} />
          <View style={{ flexDirection: 'row' }}>
            <Button title="Record payment" icon="check" onPress={() => pay(false)} style={{ flex: 1 }} />
            <Button title="In full" kind="ghost" onPress={() => pay(true)} style={{ marginLeft: 8 }} />
          </View>
        </View>
      )}

      <Text style={[styles.name, { marginTop: 20, marginBottom: 8 }]}>Payments</Text>
      {debt.payments.length === 0 && <Text style={styles.small}>None yet.</Text>}
      {[...debt.payments].reverse().map(p => (
        <View key={p.id} style={[styles.between, styles.pay]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '700' }}>{formatMoney(p.amount, cur)}</Text>
            <Text style={styles.small}>
              {prettyDateOrd(p.date)}
              {bankName(db, p.bankId) ? ` · ${bankName(db, p.bankId)}` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={() => actions.deleteDebtPayment(debt.id, p.id)} hitSlop={10}>
            <Icon name="trash" size={18} color={theme.danger} />
          </TouchableOpacity>
        </View>
      ))}
      <Button title="Delete record" kind="danger" icon="trash" onPress={remove} style={{ marginTop: 20 }} />
    </Sheet>
  );
};

export default DebtsScreen;

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caption: { color: theme.mute, fontSize: 12 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  small: { color: theme.dim, fontSize: 12 },
  amount: { fontSize: 17, fontWeight: '800' },
  big: { fontSize: 30, fontWeight: '800', marginVertical: 4 },
  pay: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
});
