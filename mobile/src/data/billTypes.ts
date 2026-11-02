import { BillType } from '../types';
import { IconName } from '../components/Icon';

/** Built-in tabs on the Monthly Bills screen, in display order. Users add more of their own. */
export const DEFAULT_BILL_TYPES: BillType[] = [
  { id: 'recharges', name: 'Recharges', kind: 'recharge' },
  { id: 'wifi', name: 'WiFi Bill', kind: 'standard' },
  { id: 'power', name: 'Power Bill', kind: 'standard' },
  { id: 'credit-cards', name: 'Credit Cards', kind: 'standard' },
  { id: 'hdb-loan', name: 'HDB Loan', kind: 'standard' },
  { id: 'home-loan', name: 'Home Loan', kind: 'standard' },
  { id: 'personal-loan', name: 'Personal Loan', kind: 'standard' },
  { id: 'schemes', name: 'Personal Schemes', kind: 'standard' }, // NPS, LIC, SIPs...
  { id: 'cheeti', name: 'Cheeti', kind: 'standard' },
  { id: 'hostel-fee', name: 'Hostel Fee', kind: 'standard' },
  { id: 'vehicle-loan', name: 'Vehicle Loan', kind: 'standard' },
  { id: 'insurance', name: 'Insurance', kind: 'standard' },
  { id: 'rent', name: 'Rent', kind: 'standard' },
  { id: 'water', name: 'Water Bill', kind: 'standard' },
  { id: 'school-fees', name: 'School Fees', kind: 'standard' },
  { id: 'subscriptions', name: 'Subscriptions', kind: 'standard' },
];

/** A hint under the tab name, so people know what belongs there. */
export const BILL_TYPE_HINTS: Record<string, string> = {
  schemes: 'NPS, LIC, SIP and similar',
  cheeti: 'Chit fund instalments',
  recharges: 'Mobile recharges by expiry date',
};

export const BILL_TYPE_ICON: IconName = 'calendar';
