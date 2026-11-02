# finTrack mobile (React Native, Android first)

## Layout

```
App.tsx                   tab shell + keeps reminders in sync with data
src/
  config.ts               BACKEND_URL, STORAGE_URL, APP_KEY  (edit this)
  types.ts                data model
  state/store.tsx         data store (context), all actions
  storage/db.ts           AsyncStorage persistence
  utils/                  money, dates, bill cycles, bank balances, interest, dues
  api/                    backend (token, AI) and cloud (backup, receipts) clients
  notifications/          local reminders (notifee)
  voice/                  Gemini Live audio helpers + function-calling tools
  screens/                Home, Bills, Debts, Activity, Spends, Interest, Voice, Settings, Auth
  components/             UI kit, pickers (calendar / time / bank / toggle), icons, animations
__tests__/                bill cycles, banks, interest, dates, data upgrade, PIN login
```

## Run

```powershell
cd D:\finTrack\mobile
npm install --legacy-peer-deps     # also applies patches/ via patch-package
npm start
npm run android
```

The app talks to your deployed Cloudflare Worker, so set `API_URL` in `src/config.ts` first (see `../cloudflare/README.md`). No local server or adb port forwarding is needed.

### Windows: `mkdir: command not found` during the build

`react-native-audio-api` downloads its native libraries with a bash script. In
PowerShell, Git's Unix tools aren't on `PATH`, so it fails. Fix for the session:

```powershell
$env:Path += ";C:\Program Files\Git\usr\bin"
```

(or add that folder to your Windows user `PATH` permanently). If another Metro
is already on 8081, use `npx react-native start --port 8082` and
`npx react-native run-android --port 8082`.

### Icon

`node scripts/generate-icons.js` redraws the dollar-coin icon (pure Node) into `android/.../res/mipmap-*` and `../web/`.

## Checks

```powershell
npx tsc --noEmit
npm test
```

## Notes

- `patches/react-native-audio-api+0.13.3.patch` is carried over from the LiveVoice app. Keep that library pinned to 0.13.3.
- Reminders use **notifee** local notifications. Android 13+ asks for permission (Reminders tab → "Turn on notifications"). Without the exact-alarm permission, Android may deliver them a few minutes late.
- On Android the mic is muted while the model speaks (no echo cancellation). With headphones set `MUTE_MIC_WHILE_MODEL_SPEAKS` to `false` in `src/screens/VoiceScreen.tsx` to talk over it.
- The voice tools (`src/voice/tools.ts`) are what let the assistant save data: `add_transaction`, `add_debt`, `record_debt_payment`, `mark_bill_paid`, `get_summary`.
