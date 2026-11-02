# finTrack

Track credits and debits, debts (owe / owed), loan EMIs and repayments, with
reminders and a Gemini Live voice assistant. Same layout as the LiveVoice app.

| Folder | What it is |
|---|---|
| [`mobile/`](mobile) | React Native app (Android first) |
| [`cloudflare/`](cloudflare) | **The server.** Cloudflare Worker + R2, deployed from GitHub: Gemini token, AI parsing and tips, receipts, backup |
| [`backend/`](backend) | Optional FastAPI copy of the AI routes, only for local experiments |
| [`web/`](web) | Landing page |

## How it fits together

```
Phone app ──token request──▶ Cloudflare Worker (holds GEMINI_API_KEY)
          ◀─single-use token─
Phone app ──voice + tool calls──▶ Gemini Live      (audio never touches your server)
Phone app ──"paid 450 groceries" / receipt──▶ Worker /ai/parse ──▶ Gemini
Phone app ──backup / receipts──▶ Worker ──▶ R2 bucket
```

All your data lives **on the phone** (AsyncStorage). The cloud backup is optional.

## The app

Seven tabs:

| Tab | What it does |
|---|---|
| **Home** | Available money across your banks, upcoming payments, this month's credits and debits, and bills paid (spends) |
| **Bills** | Monthly bills in tabs: Recharges, WiFi, Power, Credit Cards, HDB / Home / Personal / Vehicle loans, Personal Schemes (NPS), Cheeti, Hostel Fee, Insurance, Rent, Water, School Fees, Subscriptions, plus your own tabs. Each bill has a manual / auto-debit toggle, bank, date and optional time. Recharges keep only the first 4 and last 2 digits of the number |
| **Debts** | Lends and Borrow, with part-payments |
| **Activity** | Your bank accounts (add / delete, live balances) and your credits and debits |
| **Spends** | Bills paid per month, by category |
| **Interest** | Lends and borrows with interest: accrued interest, interest and principal payments |
| **Voice** | Gemini Live assistant: "I paid my power bill", "I lent 5000 to Ravi", "How much money do I have?" |

Also: reminders before every due date (auto-debit bills remind you to keep money in the bank),
sign up with email + PIN, forgot-PIN by emailed code, cloud backup, CSV export, receipt scan and
smart-add, animated UI. Bank balances are worked out from transactions, so removing a payment gives
the money back.

## Set up (no local server)

1. **Deploy the API from GitHub**: follow [`cloudflare/README.md`](cloudflare/README.md) (3 secrets, one click).
2. Put the Worker URL in `mobile/src/config.ts`, then build the app: [`mobile/README.md`](mobile/README.md).
3. Landing page (`web/`) publishes with GitHub Pages: Settings → Pages → Source: **GitHub Actions**.

## Security notes

- The sign-in is an **app lock**, not account security: the email and a salted hash of the PIN are stored on the phone, with a lockout after 5 wrong tries. Data is not encrypted with the PIN, so it doesn't protect against someone with full access to the phone's files.

- The Gemini key lives only as a Cloudflare Worker secret (set from a GitHub secret). It is **not** in the app or the repo.
- If a key was ever pasted into a chat or committed anywhere, rotate it in Google AI Studio.
- The Worker rate limits the Gemini routes (10/min per device and per IP). For real users, add proper sign-in before public release, because the device id only identifies a phone and does not prove who the user is.
