import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, Easing, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from './src/state/store';
import { syncNotifications } from './src/notifications/reminders';
import { theme } from './src/theme';
import { Account, deleteAccount, loadAccount } from './src/storage/auth';
import SplashScreen from './src/components/SplashScreen';
import { Logo, Reveal } from './src/components/anim';
import HomeScreen from './src/screens/HomeScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import DebtsScreen from './src/screens/DebtsScreen';
import VoiceScreen from './src/screens/VoiceScreen';
import BillsScreen from './src/screens/BillsScreen';
import SpendsScreen from './src/screens/SpendsScreen';
import InterestScreen from './src/screens/InterestScreen';
import SettingsSheet from './src/screens/SettingsSheet';
import { TabKey } from './src/navigation';
import { ForgotScreen, LoginScreen, SignupScreen } from './src/screens/AuthScreens';
import Icon, { IconName } from './src/components/Icon';
import { useKeyboardHeight } from './src/utils/keyboard';

const TABS: Array<{ key: TabKey; label: string; icon: IconName; title: string }> = [
  { key: 'home', label: 'Home', icon: 'home', title: 'FINTRACK' },
  { key: 'bills', label: 'Bills', icon: 'calendar', title: 'Monthly Bills' },
  { key: 'debts', label: 'Debts', icon: 'swap', title: 'Debts' },
  { key: 'activity', label: 'Activity', icon: 'wallet', title: 'Activity' },
  { key: 'spends', label: 'Spends', icon: 'pie', title: 'Spends' },
  { key: 'interest', label: 'Interest', icon: 'percent', title: 'Interest Debts' },
  { key: 'voice', label: 'Voice', icon: 'mic', title: 'Voice assistant' },
];

// Lock again if the app was in the background for longer than this.
const AUTO_LOCK_MS = 60 * 1000;

const TabButton: FC<{ icon: IconName; label: string; active: boolean; onPress: () => void }> = ({ icon, label, active, onPress }) => {
  const s = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(s, { toValue: active ? 1 : 0, speed: 16, bounciness: 16, useNativeDriver: true }).start();
  }, [active, s]);
  return (
    <TouchableOpacity style={styles.tab} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.iconWrap}>
        {/* soft pill that grows behind the active icon */}
        <Animated.View style={[styles.pill, { opacity: s, transform: [{ scaleX: s.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]} />
        <Animated.View style={{ transform: [{ translateY: s.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) }, { scale: s.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }}>
          <Icon name={icon} size={21} color={active ? theme.green : theme.dim} strokeWidth={active ? 2.3 : 1.9} />
        </Animated.View>
      </View>
      <Text style={[styles.tabLabel, active && { color: theme.green }]}>{label}</Text>
    </TouchableOpacity>
  );
};

const Shell: FC<{ onLock: () => void }> = ({ onLock }) => {
  const { db } = useStore();
  const kb = useKeyboardHeight();
  const [tab, setTab] = useState<TabKey>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  const indicator = useRef(new Animated.Value(0)).current;

  const index = TABS.findIndex(t => t.key === tab);
  useEffect(() => {
    Animated.spring(indicator, { toValue: index, speed: 14, bounciness: 10, useNativeDriver: true }).start();
  }, [index, indicator]);

  // Keep scheduled notifications matching the data (debounced: edits come in bursts).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => syncNotifications(db), 1000);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [db.bills, db.debts, db.banks, db.settings.remindDaysBefore, db.settings.currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = TABS[index];
  const tabW = barWidth / TABS.length;

  return (
    <SafeAreaView style={[styles.container, kb > 0 && { paddingBottom: kb }]} edges={kb > 0 ? ['top'] : ['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        {tab === 'home' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ marginLeft: -14, marginRight: -3, marginVertical: -14 }}>
              <Logo size={34} spin glow={false} />
            </View>
            <Text style={styles.brand}>
              FIN<Text style={{ color: theme.green }}>TRACK</Text>
            </Text>
          </View>
        ) : (
          <Reveal key={tab} distance={8}>
            <Text style={styles.title}>{current.title}</Text>
          </Reveal>
        )}
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity onPress={() => setSettingsOpen(true)} hitSlop={10} accessibilityLabel="Settings" style={[styles.lock, { marginRight: 10 }]}>
            <Icon name="sliders" size={18} color={theme.mute} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onLock} hitSlop={10} accessibilityLabel="Lock app" style={styles.lock}>
            <Icon name="lock" size={18} color={theme.mute} />
          </TouchableOpacity>
        </View>
      </View>
      {/* Only the open tab is mounted, so leaving Voice also ends its session. */}
      <Reveal key={tab} style={{ flex: 1 }} distance={14}>
        {tab === 'home' && <HomeScreen onGo={setTab} />}
        {tab === 'bills' && <BillsScreen />}
        {tab === 'debts' && <DebtsScreen />}
        {tab === 'activity' && <ActivityScreen />}
        {tab === 'spends' && <SpendsScreen />}
        {tab === 'interest' && <InterestScreen />}
        {tab === 'voice' && <VoiceScreen />}
      </Reveal>
      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {/* the keyboard would cover the tab bar anyway; hide it so content gets the room */}
      <View style={[styles.tabBar, kb > 0 && { display: 'none' }]} onLayout={e => setBarWidth(e.nativeEvent.layout.width)}>
        {barWidth > 0 && (
          <Animated.View
            style={[styles.indicator, { width: tabW * 0.5, left: tabW * 0.25, transform: [{ translateX: Animated.multiply(indicator, tabW) }] }]}
          />
        )}
        {TABS.map(t => (
          <TabButton key={t.key} icon={t.icon} label={t.label} active={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </View>
    </SafeAreaView>
  );
};

type Mode = 'login' | 'forgot';

/** Splash -> signup (first run) or PIN login -> the app. Closing the app locks it again. */
const Root: FC = () => {
  const { actions } = useStore();
  // undefined = still reading from storage, null = nobody has signed up yet.
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [splashDone, setSplashDone] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [mode, setMode] = useState<Mode>('login');
  const wentToBackgroundAt = useRef<number | null>(null);

  useEffect(() => {
    loadAccount().then(setAccount);
  }, []);

  const finishSplash = useCallback(() => setSplashDone(true), []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background') {
        wentToBackgroundAt.current = Date.now();
      } else if (state === 'active') {
        const t = wentToBackgroundAt.current;
        wentToBackgroundAt.current = null;
        if (t && Date.now() - t > AUTO_LOCK_MS) {
          setMode('login');
          setUnlocked(false);
        }
      }
    });
    return () => sub.remove();
  }, []);

  const lock = () => {
    setMode('login');
    setUnlocked(false);
  };

  const eraseEverything = async () => {
    await deleteAccount();
    actions.eraseAll();
    setAccount(null);
    setMode('login');
    setUnlocked(false);
  };

  const askSignup = () =>
    Alert.alert(
      'Create a new account?',
      'This phone already has an account. A new account starts empty, so all data on this phone will be erased.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Erase and sign up', style: 'destructive', onPress: eraseEverything },
      ],
    );

  let content: React.ReactNode = null;
  if (account !== undefined) {
    if (unlocked && account) {
      content = <Shell onLock={lock} />;
    } else if (account === null) {
      content = (
        <SignupScreen
          onCreated={a => {
            setAccount(a);
            setUnlocked(true);
          }}
        />
      );
    } else if (mode === 'forgot') {
      content = (
        <ForgotScreen
          account={account}
          onBack={() => setMode('login')}
          onErase={eraseEverything}
          onDone={a => {
            setAccount(a);
            setMode('login');
            setUnlocked(true);
          }}
        />
      );
    } else {
      content = <LoginScreen account={account} onSuccess={a => { setAccount(a); setUnlocked(true); }} onForgot={() => setMode('forgot')} onSignup={askSignup} />;
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {content}
      {!splashDone && <SplashScreen onDone={finishSplash} />}
    </View>
  );
};

const App: FC = () => (
  <SafeAreaProvider>
    <StoreProvider>
      <Root />
    </StoreProvider>
  </SafeAreaProvider>
);

export default App;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 54 },
  title: { color: theme.text, fontSize: 24, fontWeight: '800' },
  brand: { color: theme.text, fontSize: 26, fontWeight: '900', letterSpacing: 3 },
  lock: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  tabBar: { flexDirection: 'row', backgroundColor: theme.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingVertical: 6 },
  indicator: { position: 'absolute', top: 0, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: theme.green },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  iconWrap: { width: 46, height: 28, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', width: 46, height: 28, borderRadius: 14, backgroundColor: 'rgba(61,220,151,0.16)' },
  tabLabel: { color: theme.dim, fontSize: 9.5, marginTop: 2, fontWeight: '600' },
});
