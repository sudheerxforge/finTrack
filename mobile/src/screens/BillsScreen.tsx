import React, { FC, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useStore } from '../state/store';
import { Badge, Button, Card, Chips, Empty, Fab, Field, ProgressBar, Sheet } from '../components/ui';
import { BankPicker, DatePickerField, Segmented, TimePickerField } from '../components/pickers';
import { Reveal } from '../components/anim';
import Icon from '../components/Icon';
import { theme } from '../theme';
import { Bill, BillType, PayType } from '../types';
import {
  BillState,
  billDisplayName,
  billStatus,
  isRechargeType,
  maskedPhone,
  monthBillSummary,
  statusText,
  typeOf,
} from '../utils/bills';
import { bankBalance, bankName } from '../utils/banks';
import { formatMoney } from '../utils/money';
import { formatTime12, monthKey, monthLabelLong, ordinal, prettyDateOrd, today } from '../utils/dates';
import { BILL_TYPE_HINTS } from '../data/billTypes';

const STATE_COLOR: Record<BillState, string> = {
  overdue: theme.danger,
  'due-today': theme.amber,
  upcoming: theme.blue,
  paid: theme.green,
};

const ALL = 'all';

const BillsScreen: FC = () => {
  const { db, actions } = useStore();
  const cur = db.settings.currency;
  const [tabId, setTabId] = useState<string>(ALL);
  const [formFor, setFormFor] = useState<{ typeId: string; editing?: Bill } | null>(null);
  const [payId, setPayId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addTab, setAddTab] = useState(false);

  const t = today();
  const summary = useMemo(() => monthBillSummary(db, monthKey(t), t), [db, t]);

  const rows = useMemo(() => {
    const order: Record<BillState, number> = { overdue: 0, 'due-today': 1, upcoming: 2, paid: 3 };
    return db.bills
      .filter(b => tabId === ALL || b.typeId === tabId)
      .map(bill => {
        const type = typeOf(db.billTypes, bill);
        const st = billStatus(bill, type?.kind ?? 'standard', t);
        return { bill, type, st };
      })
      .sort((a, b) => order[a.st.state] - order[b.st.state] || a.st.date.localeCompare(b.st.date));
  }, [db.bills, db.billTypes, tabId, t]);

  const currentType = db.billTypes.find(x => x.id === tabId);
  const detail = db.bills.find(b => b.id === detailId) ?? null;
  const payBill = db.bills.find(b => b.id === payId) ?? null;

  const confirmDeleteTab = (type: BillType) => {
    if (!type.custom) {
      return;
    }
    const n = db.bills.filter(b => b.typeId === type.id).length;
    Alert.alert(`Delete "${type.name}"?`, n ? `Its ${n} bill${n === 1 ? '' : 's'} and their payment history will be deleted too.` : 'This tab will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          actions.deleteBillType(type.id);
          setTabId(ALL);
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
        <Reveal style={{ paddingHorizontal: 16 }}>
          <Card style={{ backgroundColor: theme.card }}>
            <View style={styles.between}>
              <View>
                <Text style={styles.cardCaption}>{monthLabelLong(monthKey(t))}</Text>
                <Text style={styles.big}>{formatMoney(summary.remaining, cur)}</Text>
                <Text style={styles.cardCaption}>left to pay this month</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.cardCaption}>
                  {summary.paidCount} of {summary.count} paid
                </Text>
                {summary.overdueCount > 0 && (
                  <View style={{ marginTop: 6 }}>
                    <Badge text={`${summary.overdueCount} OVERDUE`} color={theme.danger} />
                  </View>
                )}
              </View>
            </View>
            <View style={{ marginTop: 14 }}>
              <ProgressBar value={summary.total ? summary.paid / summary.total : 0} color={theme.green} />
              <View style={[styles.between, { marginTop: 6 }]}>
                <Text style={styles.small}>Paid {formatMoney(summary.paid, cur)}</Text>
                <Text style={styles.small}>Total {formatMoney(summary.total, cur)}</Text>
              </View>
            </View>
          </Card>
        </Reveal>

        {/* tabs: All, every bill type, and a last "+ Add" for your own */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4 }} keyboardShouldPersistTaps="handled">
          <TabChip label="All" active={tabId === ALL} onPress={() => setTabId(ALL)} />
          {db.billTypes.map(type => {
            const count = db.bills.filter(b => b.typeId === type.id).length;
            return (
              <TabChip
                key={type.id}
                label={type.name}
                count={count}
                active={tabId === type.id}
                onPress={() => setTabId(type.id)}
                onLongPress={() => confirmDeleteTab(type)}
              />
            );
          })}
          <TabChip label="Add tab" add onPress={() => setAddTab(true)} />
        </ScrollView>

        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          {currentType && BILL_TYPE_HINTS[currentType.id] ? <Text style={styles.hint}>{BILL_TYPE_HINTS[currentType.id]}</Text> : null}
          {currentType?.custom ? <Text style={styles.hint}>Your own tab. Long-press its name to delete it.</Text> : null}
          {rows.length === 0 ? (
            <Empty
              text={
                tabId === ALL
                  ? 'No bills yet.\nPick a tab above and tap + to add your first payment.'
                  : `No ${currentType?.name ?? 'bills'} added yet.\nTap + to add one.`
              }
            />
          ) : (
            rows.map(({ bill, type, st }, i) => (
              <Reveal key={bill.id} delay={Math.min(i, 6) * 50} distance={10}>
                <BillCard
                  bill={bill}
                  type={type}
                  state={st.state}
                  statusLabel={statusText(st, type?.kind ?? 'standard')}
                  date={st.date}
                  showType={tabId === ALL}
                  cur={cur}
                  bank={bankName(db, bill.bankId)}
                  onPress={() => setDetailId(bill.id)}
                  onPay={() => setPayId(bill.id)}
                />
              </Reveal>
            ))
          )}
        </View>
      </ScrollView>

      <Fab onPress={() => setFormFor({ typeId: currentType?.id ?? db.billTypes[0].id })} />

      <BillForm state={formFor} onClose={() => setFormFor(null)} />
      <PaySheet bill={payBill} onClose={() => setPayId(null)} />
      <BillDetail
        bill={detail}
        onClose={() => setDetailId(null)}
        onEdit={b => {
          setDetailId(null);
          setFormFor({ typeId: b.typeId, editing: b });
        }}
        onPay={b => {
          setDetailId(null);
          setPayId(b.id);
        }}
      />
      <AddTabSheet
        visible={addTab}
        onClose={() => setAddTab(false)}
        onAdded={id => {
          setTabId(id);
          setAddTab(false);
        }}
      />
    </View>
  );
};

// ------------------------------------------------------------------ pieces ---
const TabChip: FC<{
  label: string;
  active?: boolean;
  add?: boolean;
  count?: number;
  onPress: () => void;
  onLongPress?: () => void;
}> = ({ label, active, add, count, onPress, onLongPress }) => (
  <TouchableOpacity
    onPress={onPress}
    onLongPress={onLongPress}
    activeOpacity={0.8}
    style={[styles.tab, active && styles.tabOn, add && styles.tabAdd]}>
    {add && <Icon name="plus" size={14} color={theme.green} strokeWidth={2.6} />}
    <Text style={[styles.tabText, active && { color: '#04201a' }, add && { color: theme.green, marginLeft: 4 }]}>{label}</Text>
    {!!count && !add && (
      <View style={[styles.count, active && { backgroundColor: 'rgba(4,32,26,0.25)' }]}>
        <Text style={[styles.countText, active && { color: '#04201a' }]}>{count}</Text>
      </View>
    )}
  </TouchableOpacity>
);

const BillCard: FC<{
  bill: Bill;
  type?: BillType;
  state: BillState;
  statusLabel: string;
  date: string;
  showType: boolean;
  cur: string;
  bank?: string;
  onPress: () => void;
  onPay: () => void;
}> = ({ bill, type, state, statusLabel, date, showType, cur, bank, onPress, onPay }) => {
  const recharge = isRechargeType(type);
  const color = STATE_COLOR[state];
  const title = recharge ? maskedPhone(bill) : billDisplayName(bill, type);
  // Show the tab name under a custom name; when there is no custom name the title already is the tab name.
  const sub = recharge ? (bill.label ? bill.label : 'Mobile recharge') : showType && bill.label.trim() ? type?.name : undefined;
  const actionLabel = recharge ? 'Recharged' : bill.payType === 'auto' ? 'Confirm debit' : 'Mark paid';
  return (
    <Card onPress={onPress} style={{ borderLeftWidth: 4, borderLeftColor: color }}>
      <View style={styles.between}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {sub ? <Text style={styles.small}>{sub}</Text> : null}
        </View>
        <Text style={styles.amount}>{bill.amount ? formatMoney(bill.amount, cur) : 'Amount not set'}</Text>
      </View>

      <View style={[styles.between, { marginTop: 10 }]}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={[styles.status, { color }]}>{statusLabel}</Text>
          <Text style={styles.small}>
            {recharge ? 'Expires ' : state === 'paid' ? 'Next ' : 'Due '}
            {prettyDateOrd(date)}
            {bill.time ? ` · ${formatTime12(bill.time)}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Badge text={bill.payType === 'auto' ? 'AUTO DEBIT' : 'MANUAL'} color={bill.payType === 'auto' ? theme.violet : theme.mute} />
          {bank ? <Text style={[styles.small, { marginTop: 4 }]}>{bank}</Text> : null}
        </View>
      </View>

      {(state !== 'paid' || recharge) && (
        <View style={{ marginTop: 12 }}>
          <Button title={actionLabel} small kind={state === 'overdue' ? 'primary' : 'ghost'} icon="check" onPress={onPay} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}
    </Card>
  );
};

// -------------------------------------------------------------------- form ---
const BillForm: FC<{ state: { typeId: string; editing?: Bill } | null; onClose: () => void }> = ({ state, onClose }) => {
  const { db, actions } = useStore();
  const editing = state?.editing;
  const [typeId, setTypeId] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [payType, setPayType] = useState<PayType>('manual');
  const [bankId, setBankId] = useState<string | undefined>();
  const [p4, setP4] = useState('');
  const [p2, setP2] = useState('');

  // Fill the form each time it opens.
  useEffect(() => {
    if (!state) {
      return;
    }
    const b = state.editing;
    setTypeId(b?.typeId ?? state.typeId);
    setLabel(b?.label ?? '');
    setAmount(b?.amount ? String(b.amount) : '');
    setDate(b?.dueDate ?? '');
    setTime(b?.time ?? '');
    setPayType(b?.payType ?? 'manual');
    setBankId(b?.bankId);
    setP4(b?.phoneStart ?? '');
    setP2(b?.phoneEnd ?? '');
  }, [state]);

  const type = db.billTypes.find(x => x.id === typeId);
  const recharge = isRechargeType(type);
  const cur = db.settings.currency;

  const save = () => {
    const amt = Number(amount);
    if (recharge) {
      if (!/^\d{4}$/.test(p4) || !/^\d{2}$/.test(p2)) {
        return Alert.alert('Mobile number', 'Enter the first 4 digits and the last 2 digits of the number.');
      }
      if (!date) {
        return Alert.alert('Expiry date', 'Choose the date this recharge expires.');
      }
    } else {
      if (!(amt > 0)) {
        return Alert.alert('Amount needed', `Enter the amount in ${cur}.`);
      }
      if (!date) {
        return Alert.alert('Repayment date', 'Choose the repayment date.');
      }
    }
    if (payType === 'auto' && !bankId) {
      return Alert.alert('Bank needed', 'Auto debit needs the bank account the money is taken from.');
    }
    const data = {
      typeId,
      label,
      amount: amt > 0 ? amt : undefined,
      dueDate: date,
      time: time || undefined,
      payType,
      bankId,
      phoneStart: recharge ? p4 : undefined,
      phoneEnd: recharge ? p2 : undefined,
    };
    if (editing) {
      actions.updateBill(editing.id, data);
    } else {
      actions.addBill(data);
    }
    onClose();
  };

  const title = editing ? 'Edit payment' : `Add ${type?.name ?? 'payment'}`;

  return (
    <Sheet visible={!!state} title={title} onClose={onClose}>
      {!editing && (
        <>
          <Text style={styles.fieldLabel}>Type</Text>
          <Chips options={db.billTypes.map(x => x.id)} value={typeId} onChange={setTypeId} labels={Object.fromEntries(db.billTypes.map(x => [x.id, x.name]))} />
        </>
      )}
      <Field label="Name (optional)" value={label} onChangeText={setLabel} placeholder={recharge ? 'Whose number? e.g. Mom' : 'e.g. ICICI Amazon card'} autoCapitalize="words" />

      {recharge ? (
        <>
          <Text style={styles.fieldLabel}>
            Mobile number <Text style={{ color: theme.danger }}>*</Text>
          </Text>
          <View style={styles.phoneRow}>
            <TextInput
              style={[styles.phoneInput, { flex: 4 }]}
              value={p4}
              onChangeText={t => setP4(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="First 4"
              placeholderTextColor={theme.dim}
            />
            <Text style={styles.phoneMask}>●●●●</Text>
            <TextInput
              style={[styles.phoneInput, { flex: 2 }]}
              value={p2}
              onChangeText={t => setP2(t.replace(/\D/g, '').slice(0, 2))}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="Last 2"
              placeholderTextColor={theme.dim}
            />
          </View>
          <Text style={[styles.hint, { marginBottom: 12 }]}>Only the first 4 and last 2 digits are saved. The full number is never stored.</Text>
          <DatePickerField label="Expiry date *" value={date} onChange={setDate} placeholder="Select the expiry date" />
        </>
      ) : (
        <>
          <Field label={`Amount (${cur}) *`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
          <DatePickerField label="Repayment date *" value={date} onChange={setDate} placeholder="Select the date" hint="Repeats on this day every month." />
        </>
      )}

      <TimePickerField label="Time (optional)" value={time} onChange={setTime} />

      <Text style={styles.fieldLabel}>
        Pay type <Text style={{ color: theme.danger }}>*</Text>
      </Text>
      <Segmented
        options={[
          { value: 'manual', label: 'Manual' },
          { value: 'auto', label: 'Auto debit', icon: 'repeat' },
        ]}
        value={payType}
        onChange={setPayType}
      />
      <View style={{ height: 12 }} />
      <BankPicker
        label={payType === 'auto' ? 'Bank name' : 'Bank name (optional)'}
        required={payType === 'auto'}
        value={bankId}
        onChange={setBankId}
        hint={payType === 'auto' ? 'The account the money is debited from.' : undefined}
      />

      {recharge && <Field label={`Amount (${cur}, optional)`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Leave empty if you haven't picked a plan" hint="You can change your mind later." />}

      <Button title={editing ? 'Save changes' : 'Add payment'} onPress={save} style={{ marginTop: 6 }} />
    </Sheet>
  );
};

// ---------------------------------------------------------------- pay sheet ---
const PaySheet: FC<{ bill: Bill | null; onClose: () => void }> = ({ bill, onClose }) => {
  const { db, actions } = useStore();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [bankId, setBankId] = useState<string | undefined>();
  const [expiry, setExpiry] = useState('');

  useEffect(() => {
    if (bill) {
      setAmount(bill.amount ? String(bill.amount) : '');
      setDate(today());
      setBankId(bill.bankId);
      setExpiry('');
    }
  }, [bill]);

  if (!bill) {
    return <Sheet visible={false} title="" onClose={onClose}>{null}</Sheet>;
  }
  const type = typeOf(db.billTypes, bill);
  const recharge = isRechargeType(type);
  const cur = db.settings.currency;
  const bank = db.banks.find(b => b.id === bankId);
  const amt = Number(amount);
  const low = bank && amt > 0 && bankBalance(db, bank) < amt;

  const confirm = () => {
    if (!(amt > 0)) {
      return Alert.alert('Amount needed', 'Enter the amount you paid.');
    }
    if (recharge && !expiry) {
      return Alert.alert('New expiry date', 'Choose the date the new recharge expires.');
    }
    actions.payBill(bill.id, { amount: amt, date, bankId, newExpiry: recharge ? expiry : undefined });
    onClose();
  };

  const title = recharge ? 'Recharge done' : bill.payType === 'auto' ? 'Confirm auto debit' : 'Mark as paid';

  return (
    <Sheet visible title={title} onClose={onClose}>
      <Text style={styles.sheetName}>{recharge ? maskedPhone(bill) : billDisplayName(bill, type)}</Text>
      <Field label={`Amount paid (${cur})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" hint={bill.amount ? 'Change it if the actual amount was different.' : undefined} />
      <DatePickerField label="Paid on" value={date} onChange={setDate} />
      {recharge && <DatePickerField label="New expiry date *" value={expiry} onChange={setExpiry} placeholder="When does the new recharge expire?" />}
      <BankPicker label="Paid from (optional)" value={bankId} onChange={setBankId} hint="Choose a bank to take this off its balance." />
      {low && bank && (
        <View style={styles.warn}>
          <Icon name="alert" size={16} color={theme.amber} />
          <Text style={styles.warnText}>
            {bank.name} only has {formatMoney(bankBalance(db, bank), cur)}. It will go negative.
          </Text>
        </View>
      )}
      <Button title="Confirm" onPress={confirm} icon="check" style={{ marginTop: 6 }} />
    </Sheet>
  );
};

// ------------------------------------------------------------------- detail ---
const BillDetail: FC<{ bill: Bill | null; onClose: () => void; onEdit: (b: Bill) => void; onPay: (b: Bill) => void }> = ({
  bill,
  onClose,
  onEdit,
  onPay,
}) => {
  const { db, actions } = useStore();
  if (!bill) {
    return <Sheet visible={false} title="" onClose={onClose}>{null}</Sheet>;
  }
  const type = typeOf(db.billTypes, bill);
  const recharge = isRechargeType(type);
  const cur = db.settings.currency;
  const st = billStatus(bill, type?.kind ?? 'standard', today());
  const bank = bankName(db, bill.bankId);

  const remove = () =>
    Alert.alert('Delete this payment?', 'Its history and the transactions it created will be removed too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          actions.deleteBill(bill.id);
          onClose();
        },
      },
    ]);

  const rows: Array<[string, string]> = [
    ['Type', type?.name ?? '-'],
    ...(recharge ? ([['Number', maskedPhone(bill)]] as Array<[string, string]>) : []),
    ['Amount', bill.amount ? formatMoney(bill.amount, cur) : 'Not set'],
    [recharge ? 'Expires' : 'Repayment date', `${prettyDateOrd(bill.dueDate)}${bill.time ? ` · ${formatTime12(bill.time)}` : ''}`],
    ...(recharge ? [] : ([['Repeats', `Monthly on the ${ordinal(bill.dueDay)}`]] as Array<[string, string]>)),
    ['Pay type', bill.payType === 'auto' ? 'Auto debit' : 'Manual'],
    ['Bank', bank ?? (bill.bankId ? 'Removed' : 'Not set')],
  ];

  return (
    <Sheet visible title={billDisplayName(bill, type)} onClose={onClose}>
      <Text style={[styles.status, { color: STATE_COLOR[st.state], fontSize: 16, marginBottom: 10 }]}>{statusText(st, type?.kind ?? 'standard')}</Text>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.kv}>
          <Text style={styles.small}>{k}</Text>
          <Text style={styles.kvValue}>{v}</Text>
        </View>
      ))}

      <View style={{ flexDirection: 'row', marginTop: 16 }}>
        {(st.state !== 'paid' || recharge) && (
          <Button title={recharge ? 'Recharged' : 'Mark paid'} icon="check" onPress={() => onPay(bill)} style={{ flex: 1 }} />
        )}
        <Button title="Edit" icon="pencil" kind="ghost" onPress={() => onEdit(bill)} style={{ marginLeft: 8 }} />
      </View>

      <Text style={[styles.title, { marginTop: 22, marginBottom: 6 }]}>Payment history</Text>
      {bill.payments.length === 0 && <Text style={styles.small}>No payments recorded yet.</Text>}
      {[...bill.payments]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(p => (
          <View key={p.id} style={styles.histRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kvValue}>{formatMoney(p.amount, cur)}</Text>
              <Text style={styles.small}>
                {prettyDateOrd(p.date)}
                {bankName(db, p.bankId) ? ` · ${bankName(db, p.bankId)}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => actions.deleteBillPayment(bill.id, p.id)} hitSlop={10}>
              <Icon name="trash" size={18} color={theme.danger} />
            </TouchableOpacity>
          </View>
        ))}
      <Button title="Delete this payment item" kind="danger" icon="trash" onPress={remove} style={{ marginTop: 20 }} />
    </Sheet>
  );
};

// ------------------------------------------------------------------ add tab ---
const AddTabSheet: FC<{ visible: boolean; onClose: () => void; onAdded: (id: string) => void }> = ({ visible, onClose, onAdded }) => {
  const { db, actions } = useStore();
  const [name, setName] = useState('');
  useEffect(() => {
    if (visible) {
      setName('');
    }
  }, [visible]);
  const save = () => {
    const n = name.trim();
    if (!n) {
      return Alert.alert('Tab name', 'Enter a name, for example "Gym fee" or "Society maintenance".');
    }
    if (db.billTypes.some(t => t.name.toLowerCase() === n.toLowerCase())) {
      return Alert.alert('Already there', 'There is already a tab with that name.');
    }
    onAdded(actions.addBillType(n).id);
  };
  return (
    <Sheet visible={visible} title="Add a bill tab" onClose={onClose}>
      <Text style={[styles.small, { marginBottom: 12 }]}>Make a tab for any other monthly payment. It uses the same fields as a loan: amount, repayment date, time, pay type and bank.</Text>
      <Field label="Tab name" value={name} onChangeText={setName} placeholder="e.g. Gym fee" autoCapitalize="words" returnKeyType="done" onSubmitEditing={save} />
      <Button title="Add tab" onPress={save} />
    </Sheet>
  );
};

export default BillsScreen;

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardCaption: { color: theme.mute, fontSize: 12 },
  big: { color: theme.text, fontSize: 30, fontWeight: '800', marginVertical: 2 },
  small: { color: theme.dim, fontSize: 12 },
  hint: { color: theme.dim, fontSize: 12, marginBottom: 8 },
  title: { color: theme.text, fontSize: 16, fontWeight: '700' },
  amount: { color: theme.text, fontSize: 16, fontWeight: '800' },
  status: { fontSize: 13, fontWeight: '700' },
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, marginRight: 8, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line },
  tabOn: { backgroundColor: theme.green, borderColor: theme.green },
  tabAdd: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: 'rgba(61,220,151,0.55)' },
  tabText: { color: theme.mute, fontWeight: '700', fontSize: 13 },
  count: { marginLeft: 7, minWidth: 18, paddingHorizontal: 5, height: 18, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  countText: { color: theme.mute, fontSize: 10, fontWeight: '800' },
  fieldLabel: { color: theme.mute, fontSize: 12, marginBottom: 5, fontWeight: '600' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  phoneInput: { backgroundColor: theme.cardSoft, color: theme.text, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, fontSize: 18, letterSpacing: 3, borderWidth: 1, borderColor: theme.line, textAlign: 'center' },
  phoneMask: { color: theme.dim, fontSize: 14, marginHorizontal: 10, letterSpacing: 2 },
  sheetName: { color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 14 },
  warn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,181,71,0.1)', borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,181,71,0.3)' },
  warnText: { color: theme.amber, fontSize: 13, marginLeft: 8, flex: 1 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  kvValue: { color: theme.text, fontWeight: '600', fontSize: 14 },
  histRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
});
