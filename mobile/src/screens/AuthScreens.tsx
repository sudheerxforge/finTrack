import React, { FC, ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field } from '../components/ui';
import { AnimatedWordmark, Logo, FloatingDollars, Reveal } from '../components/anim';
import PinPad, { LinkText } from '../components/PinPad';
import { theme } from '../theme';
import {
  Account,
  PIN_LENGTH,
  createAccount,
  isValidEmail,
  normalizeEmail,
  setNewPin,
  verifyPin,
} from '../storage/auth';
import { sendResetCode, verifyResetCode } from '../api/backend';
import { useKeyboardHeight } from '../utils/keyboard';

const maskEmail = (e: string) => {
  const [name, domain] = e.split('@');
  return `${name.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(5, name.length - 1)))}@${domain}`;
};

const Shell: FC<{ children: ReactNode; compact?: boolean }> = ({ children, compact }) => {
  const kb = useKeyboardHeight();
  return (
    <SafeAreaView style={[styles.root, kb > 0 && { paddingBottom: kb }]} edges={kb > 0 ? ['top'] : ['top', 'bottom']}>
      <View style={styles.glowA} />
      <View style={styles.glowB} />
      <FloatingDollars count={14} maxOpacity={0.22} />
      <ScrollView
        contentContainerStyle={[styles.scroll, compact && { justifyContent: 'flex-start', paddingTop: 30 }]}
        keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
};

const Header: FC<{ title: string; sub?: string; coin?: boolean }> = ({ title, sub, coin = true }) => (
  <View style={{ alignItems: 'center', marginBottom: 20 }}>
    {coin && <Logo size={64} spin />}
    <View style={{ marginTop: -6 }}>
      <AnimatedWordmark size={24} />
    </View>
    <Reveal delay={500} style={{ alignItems: 'center', marginTop: 18 }}>
      <Text style={styles.title}>{title}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </Reveal>
  </View>
);

// ------------------------------------------------------------------ login ---
export const LoginScreen: FC<{
  account: Account;
  onSuccess: (a: Account) => void;
  onForgot: () => void;
  onSignup: () => void;
}> = ({ account, onSuccess, onForgot, onSignup }) => {
  const [acct, setAcct] = useState(account);
  const [pin, setPin] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  const lockedSecs = Math.max(0, Math.ceil((acct.lockedUntil - now) / 1000));
  useEffect(() => {
    if (acct.lockedUntil <= Date.now()) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [acct.lockedUntil]);

  const submit = async (value: string) => {
    setBusy(true);
    // Let the last dot animate before the (slightly CPU heavy) hash runs.
    await new Promise<void>(r => setTimeout(r, 120));
    const res = await verifyPin(acct, value);
    setBusy(false);
    if (res.ok) {
      onSuccess(res.account);
      return;
    }
    setAcct(res.account);
    setNow(Date.now());
    setShakeKey(k => k + 1);
    const left = Math.max(0, 5 - res.account.failed);
    setMsg(res.lockedForMs > 0 ? 'Too many wrong tries.' : `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before a short lock.`);
    setTimeout(() => setPin(''), 350);
  };

  return (
    <Shell>
      <Header title="Welcome back" sub={maskEmail(acct.email)} />
      <Reveal delay={650} style={{ alignItems: 'center' }}>
        <Text style={styles.label}>Enter your {PIN_LENGTH}-digit PIN</Text>
        <PinPad value={pin} onChange={setPin} onComplete={submit} shakeKey={shakeKey} error={!!msg && shakeKey > 0 && pin.length === PIN_LENGTH} disabled={busy || lockedSecs > 0} />
        {busy && <ActivityIndicator color={theme.green} style={{ marginTop: 4 }} />}
        {lockedSecs > 0 ? (
          <Text style={styles.error}>Locked. Try again in {lockedSecs}s</Text>
        ) : msg ? (
          <Text style={styles.error}>{msg}</Text>
        ) : null}
        <View style={styles.links}>
          <LinkText text="Forgot PIN?" onPress={onForgot} />
          <Text style={{ color: theme.dim }}>  ·  </Text>
          <LinkText text="Sign up" onPress={onSignup} />
        </View>
      </Reveal>
    </Shell>
  );
};

// ------------------------------------------------- choose + confirm a PIN ---
const PinSetup: FC<{ heading: string; onDone: (pin: string) => void; onBack: () => void }> = ({ heading, onDone, onBack }) => {
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [msg, setMsg] = useState('');

  const complete = (value: string) => {
    if (first === null) {
      setTimeout(() => {
        setFirst(value);
        setPin('');
        setMsg('');
      }, 200);
      return;
    }
    if (value === first) {
      onDone(value);
      return;
    }
    setShakeKey(k => k + 1);
    setMsg("PINs didn't match. Start again.");
    setTimeout(() => {
      setFirst(null);
      setPin('');
    }, 450);
  };

  return (
    <Reveal key={first === null ? 'a' : 'b'} style={{ alignItems: 'center' }} distance={10}>
      <Text style={styles.label}>{first === null ? heading : 'Enter the PIN again to confirm'}</Text>
      <PinPad value={pin} onChange={setPin} onComplete={complete} shakeKey={shakeKey} error={shakeKey > 0 && !!msg} />
      {msg ? <Text style={styles.error}>{msg}</Text> : null}
      <View style={styles.links}>
        <LinkText text="Back" onPress={first === null ? onBack : () => { setFirst(null); setPin(''); }} color={theme.mute} />
      </View>
    </Reveal>
  );
};

// ----------------------------------------------------------------- signup ---
export const SignupScreen: FC<{ onCreated: (a: Account) => void; onBack?: () => void }> = ({ onCreated, onBack }) => {
  const [step, setStep] = useState<'email' | 'pin'>('email');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const next = () => {
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');
    setStep('pin');
  };

  return (
    <Shell compact>
      <Header title={step === 'email' ? 'Create your account' : 'Set your PIN'} sub={step === 'email' ? 'Your email helps you reset your PIN later.' : `Choose a ${PIN_LENGTH}-digit PIN you will remember.`} />
      {step === 'email' ? (
        <Reveal delay={600} style={{ width: '100%' }}>
          <Field label="Email" value={email} onChangeText={t => { setEmail(t); setError(''); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="you@example.com" returnKeyType="next" onSubmitEditing={next} />
          {error ? <Text style={[styles.error, { marginTop: 0, marginBottom: 8 }]}>{error}</Text> : null}
          <Button title="Continue" onPress={next} />
          {onBack && (
            <View style={[styles.links, { justifyContent: 'center' }]}>
              <LinkText text="Back to login" onPress={onBack} color={theme.mute} />
            </View>
          )}
        </Reveal>
      ) : (
        <PinSetup heading={`Create a ${PIN_LENGTH}-digit PIN`} onBack={() => setStep('email')} onDone={async pin => onCreated(await createAccount(email, pin))} />
      )}
    </Shell>
  );
};

// ----------------------------------------------------------------- forgot ---
export const ForgotScreen: FC<{
  account: Account;
  onDone: (a: Account) => void;
  onBack: () => void;
  onErase: () => void;
}> = ({ account, onDone, onBack, onErase }) => {
  const [step, setStep] = useState<'email' | 'code' | 'pin'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [setupNote, setSetupNote] = useState(false);

  const confirmErase = () =>
    Alert.alert(
      'Erase everything and start over?',
      'This deletes all transactions, debts, loans and reminders on this phone and removes your account. Anything you backed up to the cloud stays there but this phone will no longer be linked to it. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Erase', style: 'destructive', onPress: onErase },
      ],
    );

  const send = async () => {
    setError('');
    setSetupNote(false);
    if (normalizeEmail(email) !== account.email) {
      setError('That is not the email on this account.');
      return;
    }
    setBusy(true);
    try {
      await sendResetCode(account.email);
      setStep('code');
    } catch (e: any) {
      if (e?.status === 501) {
        setSetupNote(true);
      } else {
        setError(e?.message ?? 'Could not send the code.');
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError('');
    setBusy(true);
    try {
      await verifyResetCode(account.email, code.trim());
      setStep('pin');
    } catch (e: any) {
      setError(e?.message ?? 'Could not check the code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell compact>
      <Header
        title={step === 'pin' ? 'Choose a new PIN' : 'Reset your PIN'}
        sub={step === 'email' ? 'Enter your account email and we will send a 6-digit code.' : step === 'code' ? `We sent a code to ${maskEmail(account.email)}.` : undefined}
      />
      {step === 'email' && (
        <Reveal delay={600} style={{ width: '100%' }}>
          <Field label="Account email" value={email} onChangeText={t => { setEmail(t); setError(''); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder={maskEmail(account.email)} />
          {error ? <Text style={[styles.error, { marginTop: 0, marginBottom: 8 }]}>{error}</Text> : null}
          {setupNote && (
            <View style={styles.note}>
              <Text style={{ color: theme.amber, fontWeight: '700', marginBottom: 4 }}>Email reset isn't set up yet</Text>
              <Text style={{ color: theme.mute, lineHeight: 19, fontSize: 13 }}>
                The server has no email service connected, so no code can be sent. If you can't remember your PIN, the only option is to erase this phone's data and start over.
              </Text>
            </View>
          )}
          <Button title={busy ? 'Sending…' : 'Send code'} onPress={send} disabled={busy || !email.trim()} />
          <View style={[styles.links, { justifyContent: 'center', flexDirection: 'column' }]}>
            <LinkText text="Back to login" onPress={onBack} color={theme.mute} />
            <View style={{ height: 14 }} />
            <LinkText text="Can't get the email? Erase data and start over" onPress={confirmErase} color={theme.danger} />
          </View>
        </Reveal>
      )}
      {step === 'code' && (
        <Reveal style={{ width: '100%' }}>
          <Field label="6-digit code" value={code} onChangeText={t => { setCode(t.replace(/\D/g, '').slice(0, 6)); setError(''); }} keyboardType="number-pad" maxLength={6} placeholder="123456" style={{ letterSpacing: 8, fontSize: 22, textAlign: 'center' }} />
          {error ? <Text style={[styles.error, { marginTop: 0, marginBottom: 8 }]}>{error}</Text> : null}
          <Button title={busy ? 'Checking…' : 'Verify code'} onPress={verify} disabled={busy || code.length !== 6} />
          <View style={[styles.links, { justifyContent: 'center' }]}>
            <LinkText text="Send a new code" onPress={() => { setStep('email'); setCode(''); setError(''); }} color={theme.mute} />
          </View>
        </Reveal>
      )}
      {step === 'pin' && (
        <PinSetup heading={`Create a new ${PIN_LENGTH}-digit PIN`} onBack={onBack} onDone={async pin => onDone(await setNewPin(account, pin))} />
      )}
    </Shell>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  glowA: { position: 'absolute', top: -120, left: -100, width: 340, height: 340, borderRadius: 170, backgroundColor: theme.green, opacity: 0.1 },
  glowB: { position: 'absolute', bottom: -140, right: -100, width: 360, height: 360, borderRadius: 180, backgroundColor: theme.violet, opacity: 0.14 },
  title: { color: theme.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  sub: { color: theme.mute, marginTop: 6, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  label: { color: theme.mute, fontSize: 14, marginBottom: 18, textAlign: 'center' },
  error: { color: theme.danger, marginTop: 6, textAlign: 'center', fontSize: 13 },
  links: { flexDirection: 'row', alignItems: 'center', marginTop: 20 },
  note: { backgroundColor: 'rgba(255,181,71,0.1)', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,181,71,0.3)' },
});
