import React, { FC, useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../state/store';
import { Button, Card, Chips, Sheet } from '../components/ui';
import { theme } from '../theme';
import { CURRENCIES } from '../data/categories';
import { downloadBackup, uploadBackup } from '../api/cloud';
import { prettyDateOrd, toISO } from '../utils/dates';
import { ensureNotificationPermission } from '../notifications/reminders';

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Currency, reminder timing, notifications, cloud backup and CSV export. */
const SettingsSheet: FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const { db, actions } = useStore();
  const cur = db.settings.currency;
  const [busy, setBusy] = useState<null | 'up' | 'down'>(null);

  const backup = async () => {
    setBusy('up');
    try {
      await uploadBackup(db.settings.deviceId, db);
      actions.markBackedUp();
      Alert.alert('Backed up', 'Your data is saved to your private cloud storage.');
    } catch (e: any) {
      Alert.alert('Backup failed', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const restore = () =>
    Alert.alert('Restore from cloud?', 'This replaces the data on this phone with your last backup.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        style: 'destructive',
        onPress: async () => {
          setBusy('down');
          try {
            const data = await downloadBackup(db.settings.deviceId);
            if (!data) {
              Alert.alert('No backup', 'There is no backup for this phone yet.');
            } else {
              actions.replaceAll(data);
              Alert.alert('Restored', 'Your data has been restored.');
            }
          } catch (e: any) {
            Alert.alert('Restore failed', e?.message ?? String(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const enableAlerts = async () => {
    const ok = await ensureNotificationPermission();
    Alert.alert(ok ? 'Alerts are on' : 'Alerts are off', ok ? 'You will be reminded before payments are due.' : 'Allow notifications for FINTRACK in your phone settings.');
  };

  const exportCsv = async () => {
    const rows = [['Date', 'Type', 'Category', 'Amount', 'Bank', 'Note']].concat(
      [...db.transactions]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(t => [
          t.date,
          t.kind === 'credit' ? 'Credit' : 'Debit',
          t.category,
          String(t.amount),
          db.banks.find(b => b.id === t.bankId)?.name ?? '',
          t.note,
        ]),
    );
    await Share.share({
      title: `FINTRACK ${toISO(new Date())}.csv`,
      message: rows.map(r => r.map(csvCell).join(',')).join('\n'),
    }).catch(() => {});
  };

  return (
    <Sheet visible={visible} title="Settings" onClose={onClose}>
      <Text style={styles.label}>Currency</Text>
      <Chips options={CURRENCIES} value={cur} onChange={c => actions.updateSettings({ currency: c })} />

      <Text style={styles.label}>Remind me before a payment is due</Text>
      <Chips
        options={['0', '1', '2', '3', '7']}
        value={String(db.settings.remindDaysBefore)}
        onChange={v => actions.updateSettings({ remindDaysBefore: Number(v) })}
        labels={{ '0': 'Only on the day', '1': '1 day', '2': '2 days', '3': '3 days', '7': '1 week' }}
      />
      <Text style={styles.hint}>Auto-debit bills remind you to keep money in the bank by this time. You are always reminded on the day too.</Text>
      <Button title="Turn on notifications" icon="bell" small kind="ghost" onPress={enableAlerts} style={{ alignSelf: 'flex-start', marginTop: 10, marginBottom: 18 }} />

      <Text style={styles.label}>Cloud backup</Text>
      <Card>
        <Text style={{ color: theme.dim, lineHeight: 19, marginBottom: 10 }}>
          Saved to your own Cloudflare storage.{' '}
          {db.settings.lastBackupAt ? `Last backup: ${prettyDateOrd(toISO(new Date(db.settings.lastBackupAt)))}.` : 'No backup yet.'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Button title="Back up now" small onPress={backup} disabled={!!busy} />
          <Button title="Restore" small kind="ghost" onPress={restore} disabled={!!busy} style={{ marginLeft: 8 }} />
          {busy && <ActivityIndicator color={theme.blue} style={{ marginLeft: 10 }} />}
        </View>
      </Card>

      <Button title="Export transactions (CSV)" icon="file" kind="ghost" small onPress={exportCsv} style={{ alignSelf: 'flex-start' }} />

      <Text style={styles.footer}>
        {db.banks.length} banks · {db.bills.length} bills · {db.transactions.length} transactions · {db.debts.length + db.interestDebts.length} debts
      </Text>
    </Sheet>
  );
};

export default SettingsSheet;

const styles = StyleSheet.create({
  label: { color: theme.mute, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  hint: { color: theme.dim, fontSize: 12, lineHeight: 17 },
  footer: { color: theme.dim, fontSize: 11, textAlign: 'center', marginTop: 18 },
});
