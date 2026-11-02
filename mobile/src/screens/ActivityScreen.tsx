import React, { FC, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useStore } from '../state/store';
import { Button, Card, Chips, Empty, Fab, Field, Sheet } from '../components/ui';
import { AddBankSheet, BankPicker, DatePickerField } from '../components/pickers';
import { Reveal, CountUp } from '../components/anim';
import Icon from '../components/Icon';
import { theme } from '../theme';
import { ALL_CATEGORIES, CREDIT_CATEGORIES, DEBIT_CATEGORIES } from '../data/categories';
import { bankBalance, availableMoney, bankName } from '../utils/banks';
import { formatMoney } from '../utils/money';
import { isValidISO, monthKey, monthLabelLong, prettyDateOrd, today } from '../utils/dates';
import { BankAccount, Transaction, TxKind } from '../types';
import { parseTransactions } from '../api/backend';
import { deleteReceipt, receiptSource, uploadReceipt } from '../api/cloud';

type Filter = 'all' | 'credit' | 'debit';
const PAGE = 40;

const ActivityScreen: FC = () => {
  const { db, actions } = useStore();
  const cur = db.settings.currency;
  const [filter, setFilter] = useState<Filter>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [viewing, setViewing] = useState<Transaction | null>(null);
  const [shown, setShown] = useState(PAGE);

  const list = useMemo(
    () =>
      db.transactions
        .filter(t => filter === 'all' || t.kind === filter)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [db.transactions, filter],
  );

  const confirmDeleteTx = (t: Transaction) =>
    Alert.alert(
      'Delete transaction?',
      `${t.note || t.category} · ${formatMoney(t.amount, cur)}${t.refId ? '\n\nThis also removes the payment it came from.' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (t.receiptKey) {
              deleteReceipt(db.settings.deviceId, t.receiptKey).catch(() => {});
            }
            actions.deleteTransaction(t.id);
            setViewing(null);
          },
        },
      ],
    );

  const confirmDeleteBank = (b: BankAccount) =>
    Alert.alert(
      `Delete ${b.name}?`,
      'The account is removed from your total. Its transactions stay in your history but are no longer linked to a bank.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => actions.deleteBank(b.id) },
      ],
    );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
        {/* ---------------------------------------------------------- banks --- */}
        <Reveal>
          <View style={styles.between}>
            <View>
              <Text style={styles.caption}>Available in all banks</Text>
              <CountUp value={availableMoney(db)} format={v => formatMoney(Math.round(v * 100) / 100, cur)} style={styles.total} />
            </View>
            <Button title="Add bank" icon="plus" small kind="ghost" onPress={() => setBankOpen(true)} />
          </View>
        </Reveal>

        {db.banks.length === 0 ? (
          <Card style={{ marginTop: 12 }} onPress={() => setBankOpen(true)}>
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Icon name="bank" size={30} color={theme.green} />
              <Text style={[styles.title, { marginTop: 8 }]}>Add your bank accounts</Text>
              <Text style={[styles.small, { textAlign: 'center', marginTop: 4 }]}>
                Add each bank with its balance today. Payments and transactions you link to a bank update it automatically.
              </Text>
            </View>
          </Card>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
            {db.banks.map((b, i) => (
              <Reveal key={b.id} delay={i * 70} distance={12}>
                <View style={styles.bankCard}>
                  <View style={styles.between}>
                    <View style={styles.bankIcon}>
                      <Icon name="bank" size={18} color={theme.green} />
                    </View>
                    <TouchableOpacity onPress={() => confirmDeleteBank(b)} hitSlop={10} accessibilityLabel={`Delete ${b.name}`}>
                      <Icon name="trash" size={17} color={theme.dim} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.bankName} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <Text style={styles.bankBal}>{formatMoney(bankBalance(db, b), cur)}</Text>
                </View>
              </Reveal>
            ))}
          </ScrollView>
        )}

        {/* ------------------------------------------------- credits/debits --- */}
        <Text style={styles.section}>Credits &amp; debits</Text>
        <Chips<Filter>
          options={['all', 'credit', 'debit']}
          value={filter}
          onChange={f => {
            setFilter(f);
            setShown(PAGE);
          }}
          labels={{ all: 'All', credit: 'Credits', debit: 'Debits' }}
        />
        {list.length === 0 ? (
          <Empty text={'No transactions yet.\nTap + to add one, or tell the Voice assistant.'} />
        ) : (
          list.slice(0, shown).map((item, index, arr) => {
            const showMonth = index === 0 || monthKey(arr[index - 1].date) !== monthKey(item.date);
            return (
              <View key={item.id}>
                {showMonth && <Text style={styles.month}>{monthLabelLong(monthKey(item.date))}</Text>}
                <TouchableOpacity style={styles.row} onPress={() => setViewing(item)} onLongPress={() => confirmDeleteTx(item)} activeOpacity={0.8}>
                  <View style={[styles.dot, { backgroundColor: item.kind === 'credit' ? theme.green : theme.red }]}>
                    <Icon name={item.kind === 'credit' ? 'arrow-down' : 'arrow-up'} size={18} color="#fff" strokeWidth={2.6} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>
                      {item.note || item.category}
                    </Text>
                    <Text style={styles.small} numberOfLines={1}>
                      {item.category} · {prettyDateOrd(item.date)}
                      {bankName(db, item.bankId) ? ` · ${bankName(db, item.bankId)}` : ''}
                      {item.receiptKey ? ' · Receipt' : ''}
                    </Text>
                  </View>
                  <Text style={[styles.amount, { color: item.kind === 'credit' ? theme.green : theme.text }]}>
                    {item.kind === 'credit' ? '+' : '-'}
                    {formatMoney(item.amount, cur)}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
        {list.length > shown && <Button title={`Show more (${list.length - shown})`} kind="ghost" small onPress={() => setShown(s => s + PAGE)} style={{ alignSelf: 'center', marginTop: 8 }} />}
      </ScrollView>

      <Fab onPress={() => setAddOpen(true)} />

      <AddBankSheet visible={bankOpen} onClose={() => setBankOpen(false)} />
      <AddSheet visible={addOpen} onClose={() => setAddOpen(false)} />

      <Sheet visible={!!viewing} title="Transaction" onClose={() => setViewing(null)}>
        {viewing && (
          <>
            <Text style={[styles.big, { color: viewing.kind === 'credit' ? theme.green : theme.text }]}>
              {viewing.kind === 'credit' ? '+' : '-'}
              {formatMoney(viewing.amount, cur)}
            </Text>
            <Text style={styles.small}>
              {viewing.category} · {prettyDateOrd(viewing.date)}
            </Text>
            {bankName(db, viewing.bankId) ? <Text style={[styles.small, { marginTop: 2 }]}>Bank: {bankName(db, viewing.bankId)}</Text> : null}
            {!!viewing.note && <Text style={[styles.title, { marginTop: 10 }]}>{viewing.note}</Text>}
            {viewing.receiptKey && <Image source={receiptSource(db.settings.deviceId, viewing.receiptKey)} style={styles.receipt} resizeMode="contain" />}
            <Button title="Delete" kind="danger" icon="trash" onPress={() => confirmDeleteTx(viewing)} style={{ marginTop: 16 }} />
          </>
        )}
      </Sheet>
    </View>
  );
};

/** Manual form plus two shortcuts: type a sentence, or scan a receipt. */
const AddSheet: FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const { db, actions } = useStore();
  const cur = db.settings.currency;
  const [kind, setKind] = useState<TxKind>('debit');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Food');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  const [bankId, setBankId] = useState<string | undefined>();
  const [magic, setMagic] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ uri: string; type: string } | null>(null);

  // Start fresh each time, with the first bank selected.
  useEffect(() => {
    if (visible) {
      setKind('debit');
      setAmount('');
      setCategory('Food');
      setNote('');
      setDate(today());
      setMagic('');
      setReceipt(null);
      setBankId(db.banks[0]?.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const cats = kind === 'debit' ? DEBIT_CATEGORIES : CREDIT_CATEGORIES;

  const save = async () => {
    const n = Number(amount);
    if (!(n > 0)) {
      return Alert.alert('Amount needed', 'Enter an amount greater than 0.');
    }
    if (!date || !isValidISO(date)) {
      return Alert.alert('Date', 'Choose a date.');
    }
    setBusy(true);
    let receiptKey: string | undefined;
    if (receipt) {
      try {
        receiptKey = await uploadReceipt(db.settings.deviceId, receipt.uri, receipt.type);
      } catch (e: any) {
        Alert.alert('Receipt not saved', `${e?.message ?? e}\n\nThe transaction will be saved without the photo.`);
      }
    }
    actions.addTransaction({ kind, amount: n, category, note: note.trim(), date, bankId, receiptKey });
    setBusy(false);
    onClose();
  };

  /** Asks the backend to turn a sentence or photo into transactions, then lets the user confirm. */
  const smartAdd = async (input: { text?: string; imageBase64?: string; mimeType?: string }) => {
    setBusy(true);
    try {
      const found = await parseTransactions({ ...input, categories: ALL_CATEGORIES });
      if (!found.length) {
        Alert.alert('Nothing found', 'Could not find a transaction there. Try the form below.');
        return;
      }
      if (found.length === 1) {
        const t = found[0];
        setKind(t.kind);
        setAmount(String(t.amount));
        setCategory(t.category);
        setNote(t.note);
        setDate(isValidISO(t.date) ? t.date : today());
        return;
      }
      Alert.alert(
        `${found.length} transactions found`,
        found.map(t => `${t.kind === 'credit' ? '+' : '-'}${formatMoney(t.amount, cur)}  ${t.note || t.category}`).join('\n'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add all',
            onPress: () => {
              found.forEach(t =>
                actions.addTransaction({
                  kind: t.kind,
                  amount: t.amount,
                  category: t.category,
                  note: t.note,
                  date: isValidISO(t.date) ? t.date : today(),
                  bankId,
                }),
              );
              onClose();
            },
          },
        ],
      );
    } catch (e: any) {
      Alert.alert('AI helper unavailable', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const scan = async (fromCamera: boolean) => {
    const res = await (fromCamera ? launchCamera : launchImageLibrary)({
      mediaType: 'photo',
      includeBase64: true,
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 0.7,
    });
    const asset = res.assets?.[0];
    if (res.didCancel || !asset?.base64) {
      if (res.errorMessage) {
        Alert.alert('Camera', res.errorMessage);
      }
      return;
    }
    const type = asset.type ?? 'image/jpeg';
    if (asset.uri) {
      setReceipt({ uri: asset.uri, type });
    }
    await smartAdd({ imageBase64: asset.base64, mimeType: type });
  };

  return (
    <Sheet visible={visible} title="Add transaction" onClose={onClose}>
      <Field
        label="Quick add (type or paste, AI fills the form)"
        value={magic}
        onChangeText={setMagic}
        placeholder="e.g. paid 450 for groceries yesterday"
        returnKeyType="go"
        onSubmitEditing={() => magic.trim() && smartAdd({ text: magic.trim() })}
      />
      <View style={{ flexDirection: 'row', marginBottom: 14, alignItems: 'center' }}>
        <Button title="Fill" icon="zap" small kind="ghost" disabled={busy || !magic.trim()} onPress={() => smartAdd({ text: magic.trim() })} />
        <Button title="Scan receipt" icon="camera" small kind="ghost" disabled={busy} onPress={() => scan(true)} style={{ marginLeft: 8 }} />
        <Button title="Gallery" icon="image" small kind="ghost" disabled={busy} onPress={() => scan(false)} style={{ marginLeft: 8 }} />
        {busy && <ActivityIndicator style={{ marginLeft: 10 }} color={theme.blue} />}
      </View>

      <Chips<TxKind>
        options={['debit', 'credit']}
        value={kind}
        onChange={k => {
          setKind(k);
          setCategory(k === 'debit' ? 'Food' : 'Salary');
        }}
        labels={{ debit: 'Debit (money out)', credit: 'Credit (money in)' }}
      />
      <Field label={`Amount (${cur})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
      <Text style={styles.lbl}>Category</Text>
      <Chips options={cats} value={category} onChange={setCategory} />
      <BankPicker label="Bank account" value={bankId} onChange={setBankId} hint="Pick a bank so its balance updates." />
      <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional" />
      <DatePickerField label="Date" value={date} onChange={setDate} />
      {receipt && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <Icon name="file" size={15} color={theme.mute} />
          <Text style={[styles.small, { marginLeft: 6 }]}>Receipt photo attached</Text>
        </View>
      )}
      <Button title="Save" onPress={save} disabled={busy} style={{ marginTop: 8 }} />
    </Sheet>
  );
};

export default ActivityScreen;

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caption: { color: theme.mute, fontSize: 12 },
  total: { color: theme.text, fontSize: 30, fontWeight: '800' },
  section: { color: theme.text, fontSize: 17, fontWeight: '800', marginTop: 22, marginBottom: 10 },
  bankCard: { width: 168, backgroundColor: theme.card, borderRadius: 18, padding: 14, marginRight: 12, borderWidth: 1, borderColor: theme.line },
  bankIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(61,220,151,0.14)', alignItems: 'center', justifyContent: 'center' },
  bankName: { color: theme.mute, fontSize: 13, fontWeight: '600', marginTop: 12 },
  bankBal: { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  month: { color: theme.mute, fontWeight: '700', fontSize: 12, marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 14, padding: 12, marginBottom: 8 },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  title: { color: theme.text, fontSize: 15, fontWeight: '600' },
  small: { color: theme.dim, fontSize: 12, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '700', marginLeft: 8 },
  big: { fontSize: 32, fontWeight: '800' },
  lbl: { color: theme.mute, fontSize: 12, marginBottom: 5, fontWeight: '600' },
  receipt: { width: '100%', height: 280, marginTop: 14, borderRadius: 12, backgroundColor: theme.cardSoft },
});
