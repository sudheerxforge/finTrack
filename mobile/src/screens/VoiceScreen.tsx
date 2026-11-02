import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  AudioBufferQueueSourceNode,
  AudioContext,
  AudioManager,
  AudioRecorder,
} from 'react-native-audio-api';
import { fetchLiveToken, liveSocketUrl } from '../api/backend';
import VoiceOrb, { OrbMode } from '../components/VoiceOrb';
import { Chips } from '../components/ui';
import { useStore } from '../state/store';
import { theme } from '../theme';
import Icon from '../components/Icon';
import { today } from '../utils/dates';
import { FUNCTION_DECLARATIONS, runTool } from '../voice/tools';
import {
  float32ToPcm16Base64,
  pcm16Base64ToFloat32,
  resample,
  utf8Decode,
} from '../voice/audioUtils';
import { newId } from '../utils/ids';

const MODEL = 'models/gemini-3.8-live';
const VOICES = ['Iapetus', 'Puck', 'Kore', 'Aoede', 'Charon', 'Zephyr'] as const;

// Gemini Live expects 16-bit PCM mono input and returns 24 kHz PCM mono.
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const INPUT_CHUNK_FRAMES = 1024;

// Android has no echo cancellation here, so mute the mic while the model talks
// (no barge-in on the loudspeaker). Use headphones + set false to interrupt.
const MUTE_MIC_WHILE_MODEL_SPEAKS = Platform.OS === 'android';
const MIC_GATE_TAIL_MS = 300;

type Status = 'Disconnected' | 'Connecting...' | 'Listening' | 'Speaking' | 'Error' | 'Microphone permission denied';

interface Line {
  id: string;
  role: 'user' | 'model' | 'action';
  text: string;
  /** For action lines: false = a problem. */
  ok?: boolean;
}

interface ServerMessage {
  setupComplete?: object;
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls?: Array<{ id: string; name: string; args?: Record<string, any> }> };
  goAway?: { timeLeft?: string };
}

const SUGGESTIONS = [
  'I paid my power bill',
  'I lent 5000 to Ravi',
  'How much money do I have?',
  'Which bills are due this week?',
];

const VoiceScreen: FC = () => {
  const { db, dbRef, actions } = useStore();
  const [status, setStatus] = useState<Status>('Disconnected');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [voice, setVoice] = useState<(typeof VOICES)[number]>('Iapetus');

  const ws = useRef<WebSocket | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const player = useRef<AudioBufferQueueSourceNode | null>(null);
  const recorder = useRef<AudioRecorder | null>(null);
  const playbackEndsAt = useRef(0);
  const curUser = useRef<string | null>(null);
  const curModel = useRef<string | null>(null);
  const list = useRef<FlatList<Line>>(null);
  // Latest actions for use inside socket callbacks created once per session.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const isActive = status === 'Connecting...' || status === 'Listening' || status === 'Speaking';

  const endTurn = () => {
    curUser.current = null;
    curModel.current = null;
  };

  const append = (role: 'user' | 'model', text: string) => {
    const ref = role === 'user' ? curUser : curModel;
    if (ref.current) {
      const id = ref.current;
      setLines(prev => prev.map(l => (l.id === id ? { ...l, text: l.text + text } : l)));
      return;
    }
    const id = newId();
    ref.current = id;
    const replyId = curModel.current;
    setLines(prev => {
      const line: Line = { id, role, text };
      // The user's transcript can arrive after the reply starts; keep it above.
      const idx = role === 'user' && replyId ? prev.findIndex(l => l.id === replyId) : -1;
      return idx === -1 ? [...prev, line] : [...prev.slice(0, idx), line, ...prev.slice(idx)];
    });
  };

  const stopSession = useCallback((finalStatus: Status = 'Disconnected') => {
    const socket = ws.current;
    ws.current = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
    const rec = recorder.current;
    recorder.current = null;
    if (rec) {
      rec.clearOnAudioReady();
      rec.clearOnError();
      if (rec.isRecording()) {
        rec.stop().catch(() => {});
      }
    }
    player.current = null;
    const ctx = audioCtx.current;
    audioCtx.current = null;
    ctx?.close().catch(() => {});
    playbackEndsAt.current = 0;
    curUser.current = null;
    curModel.current = null;
    AudioManager.setAudioSessionActivity(false).catch(() => {});
    setStatus(finalStatus);
  }, []);

  useEffect(() => {
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'voiceChat',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
    });
    return () => stopSession();
  }, [stopSession]);

  const playChunk = (base64: string) => {
    const ctx = audioCtx.current;
    const node = player.current;
    if (!ctx || !node) {
      return;
    }
    // The queue player doesn't resample, so match the context's rate first.
    const samples = resample(pcm16Base64ToFloat32(base64), OUTPUT_SAMPLE_RATE, ctx.sampleRate);
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    node.enqueueBuffer(buffer);
    playbackEndsAt.current = Math.max(Date.now(), playbackEndsAt.current) + (samples.length / ctx.sampleRate) * 1000;
    setStatus('Speaking');
  };

  const startMicrophone = async () => {
    const rec = new AudioRecorder();
    recorder.current = rec;
    rec.onError(e => setError(`Microphone error: ${e.message}`));
    rec.onAudioReady(
      { sampleRate: INPUT_SAMPLE_RATE, bufferLength: INPUT_CHUNK_FRAMES, channelCount: 1 },
      ({ buffer }) => {
        const socket = ws.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        if (MUTE_MIC_WHILE_MODEL_SPEAKS && Date.now() < playbackEndsAt.current + MIC_GATE_TAIL_MS) {
          return;
        }
        socket.send(
          JSON.stringify({
            realtimeInput: {
              audio: {
                mimeType: `audio/pcm;rate=${Math.round(buffer.sampleRate)}`,
                data: float32ToPcm16Base64(buffer.getChannelData(0)),
              },
            },
          }),
        );
      },
    );
    const result = await rec.start();
    if (result.status === 'error') {
      throw new Error(result.message);
    }
  };

  const handleToolCalls = (calls: NonNullable<ServerMessage['toolCall']>['functionCalls']) => {
    const responses = (calls ?? []).map(call => {
      const result = runTool(call.name, call.args ?? {}, () => dbRef.current, actionsRef.current);
      const r = result as { ok?: boolean; saved?: string; recorded?: string; error?: string };
      if (r.ok) {
        const what = r.saved ?? (r.recorded ? `Payment ${r.recorded} recorded` : 'Done');
        setLines(prev => [...prev, { id: newId(), role: 'action', text: what, ok: true }]);
      } else if (r.error) {
        setLines(prev => [...prev, { id: newId(), role: 'action', text: r.error ?? "Something went wrong", ok: false }]);
      }
      return { id: call.id, name: call.name, response: { output: result } };
    });
    ws.current?.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
  };

  const handleServerMessage = (msg: ServerMessage) => {
    if (msg.setupComplete) {
      setStatus('Listening');
      startMicrophone().catch(e => {
        setError(`Could not start microphone: ${e?.message ?? e}`);
        stopSession('Error');
      });
      return;
    }

    if (msg.toolCall?.functionCalls?.length) {
      handleToolCalls(msg.toolCall.functionCalls);
    }

    const content = msg.serverContent;
    if (content) {
      if (content.interrupted) {
        player.current?.clearBuffers();
        playbackEndsAt.current = 0;
        endTurn();
        setStatus('Listening');
      }
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          playChunk(part.inlineData.data);
        }
      }
      if (content.inputTranscription?.text) {
        append('user', content.inputTranscription.text);
      }
      if (content.outputTranscription?.text) {
        append('model', content.outputTranscription.text);
      }
      if (content.turnComplete) {
        endTurn();
        const remaining = Math.max(0, playbackEndsAt.current - Date.now());
        setTimeout(() => {
          if (ws.current && Date.now() >= playbackEndsAt.current) {
            setStatus('Listening');
          }
        }, remaining);
      }
    }
  };

  const systemPrompt = () => {
    const cur = dbRef.current.settings.currency;
    return (
      'You are FINTRACK, a friendly, concise voice assistant for personal money tracking. ' +
      `Today is ${today()}. The user's currency symbol is "${cur}". ` +
      'You can record transactions, lends and borrows (money given to or taken from people), repayments, ' +
      "and mark the user's monthly bills as paid. You can also read their data with get_summary: " +
      'available money across bank accounts, bills still to pay, this month, lends and borrows. ' +
      'Rules: (1) When the user states a clear action, call the tool right away, then confirm in one ' +
      'short sentence what you saved. (2) If an amount, person, bill or whether money was spent or ' +
      'received is unclear, ask one short question first. Never guess an amount. (3) For a recharge ' +
      'you must ask for the new expiry date. (4) Before answering any question about money, balances, ' +
      'bills or debts, call get_summary and use its numbers only. (5) Say amounts naturally, without ' +
      'reading symbols aloud. (6) You are not a financial adviser: no investment, tax or legal advice. ' +
      '(7) Keep replies to one or two short sentences. Reply in the language the user speaks.'
    );
  };

  const startSession = async () => {
    setError(null);
    endTurn();
    const permission = await AudioManager.requestRecordingPermissions();
    if (permission !== 'Granted') {
      setStatus('Microphone permission denied');
      return;
    }
    setStatus('Connecting...');

    let token: string;
    try {
      token = await fetchLiveToken(MODEL);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStatus('Error');
      return;
    }

    try {
      await AudioManager.setAudioSessionActivity(true);
      const ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      audioCtx.current = ctx;
      const node = ctx.createBufferQueueSource({ pitchCorrection: true });
      node.connect(ctx.destination);
      // react-native-audio-api 0.13.3 defaults offset to -1 and then rejects it.
      node.start(0, 0);
      player.current = node;
    } catch (e: any) {
      setError(`Could not start audio output: ${e?.message ?? e}`);
      stopSession('Error');
      return;
    }

    const socket = new WebSocket(liveSocketUrl(token));
    (socket as WebSocket & { binaryType: string }).binaryType = 'arraybuffer';
    ws.current = socket;

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          setup: {
            model: MODEL,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
            systemInstruction: { parts: [{ text: systemPrompt() }] },
            tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }),
      );
    };
    socket.onmessage = event => {
      try {
        const raw = typeof event.data === 'string' ? event.data : utf8Decode(event.data as ArrayBuffer);
        handleServerMessage(JSON.parse(raw));
      } catch (e) {
        console.error('Failed to handle Gemini message:', e);
      }
    };
    socket.onerror = (e: any) => setError(e?.message ?? 'WebSocket error');
    socket.onclose = e => {
      if (e.code !== 1000) {
        setError(`Connection closed (${e.code}) ${e.reason ?? ''}`.trim());
        stopSession('Error');
      } else {
        stopSession();
      }
    };
  };

  const orbMode: OrbMode = status === 'Listening' ? 'listening' : status === 'Speaking' ? 'speaking' : status === 'Connecting...' ? 'thinking' : 'idle';
  const statusText =
    status === 'Disconnected' ? 'Tap start and just talk' : status === 'Connecting...' ? 'Getting ready…' : status === 'Listening' ? "I'm listening…" : status === 'Speaking' ? 'Speaking…' : status;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={list}
        data={lines}
        keyExtractor={l => l.id}
        contentContainerStyle={lines.length ? { padding: 16 } : styles.empty}
        onContentSizeChange={() => list.current?.scrollToEnd()}
        ListEmptyComponent={
          <View style={{ alignItems: 'center' }}>
            <VoiceOrb mode={orbMode} size={130} />
            <Text style={styles.hello}>Your money, by voice</Text>
            <Text style={styles.helloSub}>Try saying:</Text>
            {SUGGESTIONS.map(s => (
              <Text key={s} style={styles.suggest}>
                “{s}”
              </Text>
            ))}
          </View>
        }
        renderItem={({ item }) =>
          item.role === 'action' ? (
            <View style={styles.actionRow}>
              <Icon name={item.ok === false ? 'alert' : 'check'} size={15} color={item.ok === false ? theme.amber : theme.green} strokeWidth={2.6} />
              <Text style={[styles.action, item.ok === false && { color: theme.amber }]}>{item.text}</Text>
            </View>
          ) : (
            <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.modelBubble]}>
              <Text style={{ color: theme.text, fontSize: 15, lineHeight: 21 }}>{item.text}</Text>
            </View>
          )
        }
      />
      {lines.length > 0 && (
        <View style={{ alignItems: 'center', marginBottom: 4 }}>
          <VoiceOrb mode={orbMode} size={56} />
        </View>
      )}
      <Text style={styles.status}>{statusText}</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {!isActive && (
        <View style={{ paddingHorizontal: 16 }}>
          <Chips options={VOICES} value={voice} onChange={setVoice} />
        </View>
      )}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: isActive ? theme.danger : theme.blue }]}
        onPress={isActive ? () => stopSession() : startSession}
        activeOpacity={0.85}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {!isActive && <Icon name="mic" size={20} color="#fff" />}
          <Text style={[styles.buttonText, !isActive && { marginLeft: 8 }]}>{isActive ? 'Stop' : 'Start talking'}</Text>
        </View>
      </TouchableOpacity>
      {lines.length > 0 && !isActive && (
        <TouchableOpacity onPress={() => setLines([])} style={{ alignItems: 'center', paddingBottom: 8 }}>
          <Text style={{ color: theme.dim, fontSize: 12 }}>Clear conversation ({db.transactions.length} transactions saved)</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default VoiceScreen;

const styles = StyleSheet.create({
  empty: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  hello: { color: theme.text, fontSize: 22, fontWeight: '800', marginTop: 28 },
  helloSub: { color: theme.dim, marginTop: 12, marginBottom: 6 },
  suggest: { color: theme.mute, fontSize: 14, marginTop: 4 },
  bubble: { maxWidth: '85%', padding: 12, borderRadius: 16, marginBottom: 8 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: theme.blue },
  modelBubble: { alignSelf: 'flex-start', backgroundColor: theme.card },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 6 },
  action: { color: theme.green, fontWeight: '600', fontSize: 13, marginLeft: 6, textAlign: 'center', flexShrink: 1 },
  status: { color: theme.mute, textAlign: 'center', marginBottom: 8 },
  error: { color: theme.danger, textAlign: 'center', marginHorizontal: 20, marginBottom: 8, fontSize: 12 },
  button: { marginHorizontal: 16, marginBottom: 12, paddingVertical: 16, borderRadius: 28, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
