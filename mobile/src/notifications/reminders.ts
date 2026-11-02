import { Platform } from 'react-native';
import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  TimestampTrigger,
  TriggerType,
} from '@notifee/react-native';
import { DB } from '../types';
import { notificationDues } from '../utils/summary';
import { formatMoney } from '../utils/money';
import { addDaysISO } from '../utils/dates';

const CHANNEL_ID = 'dues';
// Android/iOS cap pending local notifications; keep the soonest ones.
const MAX_SCHEDULED = 50;

export async function ensureNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

async function ensureChannel(): Promise<string | undefined> {
  if (Platform.OS !== 'android') {
    return undefined;
  }
  return notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Payment reminders',
    importance: AndroidImportance.HIGH,
  });
}

function atTime(dateISO: string, time: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

export interface Planned {
  key: string;
  when: number;
  title: string;
  body: string;
}

/**
 * What to notify and when: a heads-up N days before and a reminder on the day.
 * Auto-debit bills say "keep money in <bank>" ahead of time instead of "pay".
 */
export function planNotifications(db: DB, now = Date.now()): Planned[] {
  const cur = db.settings.currency;
  const before = db.settings.remindDaysBefore;
  const planned: Planned[] = [];

  for (const due of notificationDues(db)) {
    const amount = due.amount ? ` · ${formatMoney(due.amount, cur)}` : '';
    const bank = due.bank ? ` in ${due.bank}` : '';

    const onDay = atTime(due.date, due.time);
    if (onDay > now) {
      planned.push({
        key: `${due.id}-day`,
        when: onDay,
        title: due.title,
        body: due.autoDebit ? `Auto debit today${amount}. Make sure the money is${bank || ' in your bank'}.` : `Due today${amount}`,
      });
    }
    if (before > 0) {
      const early = atTime(addDaysISO(due.date, -before), due.time);
      if (early > now) {
        const when = `in ${before} day${before === 1 ? '' : 's'}`;
        planned.push({
          key: `${due.id}-early`,
          when: early,
          title: due.title,
          body: due.autoDebit ? `Auto debit ${when}${amount}. Keep enough money${bank || ' in your bank'}.` : `Due ${when}${amount}`,
        });
      }
    }
  }
  return planned.sort((a, b) => a.when - b.when).slice(0, MAX_SCHEDULED);
}

/** Replaces all scheduled reminders with ones matching the current data. */
export async function syncNotifications(db: DB): Promise<void> {
  try {
    const channelId = await ensureChannel();
    await notifee.cancelTriggerNotifications();
    for (const p of planNotifications(db)) {
      const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: p.when };
      await notifee.createTriggerNotification(
        {
          id: p.key,
          title: p.title,
          body: p.body,
          android: { channelId, pressAction: { id: 'default' }, smallIcon: 'ic_launcher' },
        },
        trigger,
      );
    }
  } catch (e) {
    console.warn('[finTrack] could not schedule reminders:', e);
  }
}
