import type * as finch from 'finch';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createNotchBird } from './bird.js';
import {
  CUE_EVENTS,
  CUE_LABELS,
  DEFAULT_SOUNDS,
  TERMINAL_PRIORITY,
  classify,
  inQuietHours,
  resolveSoundPath,
  toAfplayVolume,
  type CueEvent,
} from './logic.js';

const TERMINAL_SETTLE_MS = 700; // wait for competing terminal events + unread state
const GLOBAL_GAP_MS = 800; // never play two cues closer than this
const BG_DONE_TTL_MS = 8000;

interface SessionState {
  terminalFired: boolean;
  pendingTerminal?: { cue: CueEvent; timer: NodeJS.Timeout; since: number };
  waiting: boolean;
  startedFired: boolean;
  lastRetryAt: number;
  lastToolErrorAt: number;
}

export function activate(ctx: finch.MiniToolContext): void {
  const s = ctx.settings;
  const home = homedir();
  const soundsDir = fileURLToPath(new URL('../sounds/', import.meta.url));
  const sessions = new Map<string, SessionState>();
  const bgDone = new Map<string, number>();
  let lastPlayedAt = 0;
  let muted = false;

  void ctx.storage.get<boolean>('muted').then((v) => { muted = v === true; });

  const enabled = () => s.get<boolean>('enabled') ?? true;
  const onlyUnviewed = () => s.get<boolean>('onlyWhenUnviewed') ?? true;
  const alwaysRing = () => new Set(s.get<string[]>('alwaysRing') ?? ['interrupted']);
  const soundFor = (cue: CueEvent) =>
    resolveSoundPath(s.get<string>(`${cue}Sound`) ?? DEFAULT_SOUNDS[cue], s.get<string>(`${cue}Custom`), home, soundsDir);

  function state(sid: string): SessionState {
    let st = sessions.get(sid);
    if (!st) {
      st = { terminalFired: false, waiting: false, startedFired: false, lastRetryAt: 0, lastToolErrorAt: 0 };
      sessions.set(sid, st);
    }
    return st;
  }

  function play(file: string, force = false): boolean {
    const now = Date.now();
    if (!force && now - lastPlayedAt < GLOBAL_GAP_MS) return false;
    if (!existsSync(file)) {
      ctx.logger.warn('sound file not found', file);
      return false;
    }
    lastPlayedAt = now;
    const vol = String(toAfplayVolume(s.get<number>('volume') ?? 60));
    const child = spawn('afplay', ['-v', vol, file], { stdio: 'ignore', detached: false });
    child.on('error', (err) => ctx.logger.warn('afplay failed', String(err)));
    return true;
  }

  function isFinchFrontmost(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('/bin/sh', ['-c', 'lsappinfo info -only name "$(lsappinfo front)"'], { timeout: 1500 }, (err, out) => {
        if (err) return resolve(true); // unknown → assume visible, fall back to unread check
        resolve(/finch/i.test(String(out)));
      });
    });
  }

  // Status only exposes the *latest* unread session, so remember every session that has been the
  // latest unread at some point: when two runs finish close together, both still count as unread.
  const unreadSeen = new Map<string, number>();
  const noteStatus = (st: finch.FinchStatusSnapshot) => {
    if (st.unreadCount > 0 && st.latestUnreadSessionId) unreadSeen.set(st.latestUnreadSessionId, Date.now());
  };
  ctx.subscriptions.push(ctx.status.onDidChange(noteStatus));

  async function isUnviewed(sid: string, since: number): Promise<boolean> {
    const bg = bgDone.get(sid);
    if (bg && Date.now() - bg < BG_DONE_TTL_MS) return true;
    if (!(await isFinchFrontmost())) return true;
    // Finch is in front: the run counts as unviewed if it became unread. The unread flag can land a
    // little after the run's terminal event, so check a few times before giving up.
    for (let i = 0; i < 4; i++) {
      if ((unreadSeen.get(sid) ?? 0) >= since - 1500) return true;
      try {
        const st = await ctx.status.get();
        noteStatus(st);
        if (st.unreadCount > 0 && st.latestUnreadSessionId === sid) return true;
      } catch { /* ignore and retry */ }
      if (i < 3) await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  const birdOn = () => s.get<boolean>('notchBird') ?? true;
  const birdEvents = () => new Set(s.get<string[]>('notchBirdEvents') ?? ['completed']);
  const bird = createNotchBird(ctx, {
    seconds: () => Number(s.get<number>('notchBirdSeconds') ?? 15) || 15,
    untilClick: () => s.get<boolean>('notchBirdUntilClick') ?? true,
    onOpen: (sid) => {
      void ctx.navigation.openSession(sid).catch((e) => ctx.logger.warn('open session failed', String(e)));
      execFile('osascript', ['-e', 'tell application "Finch" to activate'], { timeout: 2000 }, () => undefined);
    },
  });
  ctx.subscriptions.push({ dispose: () => bird.dispose() });

  // In stay-until-click mode the bird also flies home once its letters are read some other way.
  // Only after an unread conversation was seen while it is out, so it never vanishes on arrival.
  let unreadWhileBird = false;
  ctx.subscriptions.push(ctx.status.onDidChange((st) => {
    if (!bird.isOut()) { unreadWhileBird = false; return; }
    if (st.unreadCount > 0) unreadWhileBird = true;
    else if (unreadWhileBird) { unreadWhileBird = false; bird.lettersRead(); }
  }));

  async function fire(cue: CueEvent, sid: string, since = Date.now()): Promise<void> {
    if (!enabled()) return;
    // Sound obeys mute + quiet hours; the bird is silent, so it only obeys its own switch.
    const file = muted || inQuietHours(s.get<string>('quietHours'), new Date()) ? undefined : soundFor(cue);
    const wantsBird = birdOn() && birdEvents().has(cue);
    if (!file && !wantsBird) return;
    if (onlyUnviewed() && !alwaysRing().has(cue) && !(await isUnviewed(sid, since))) {
      ctx.logger.info(`skipped ${cue}: the conversation is being viewed`);
      return;
    }
    // Two runs finishing together: the second sound would be swallowed by the gap, so delay it instead.
    if (file && !play(file)) setTimeout(() => play(file, true), GLOBAL_GAP_MS);
    if (wantsBird) {
      const seen = (unreadSeen.get(sid) ?? 0) >= since - 1500;
      unreadWhileBird = seen || (unreadWhileBird && bird.isOut());
      void bird.show(sid).catch((e) => ctx.logger.warn('bird failed', String(e)));
    }
  }

  function onCue(cue: CueEvent, sid: string): void {
    const st = state(sid);
    const now = Date.now();

    if (cue === 'started') {
      // New run: reset per-run dedupe.
      st.terminalFired = false;
      st.waiting = false;
      if (st.pendingTerminal) { clearTimeout(st.pendingTerminal.timer); st.pendingTerminal = undefined; }
      if (st.startedFired) return;
      st.startedFired = true;
      void fire('started', sid);
      return;
    }

    const prio = TERMINAL_PRIORITY[cue];
    if (prio !== undefined) {
      st.waiting = false;
      if (st.terminalFired) return;
      const pending = st.pendingTerminal;
      if (pending) {
        if ((TERMINAL_PRIORITY[pending.cue] ?? 0) >= prio) return;
        clearTimeout(pending.timer);
      }
      const since = pending?.since ?? now;
      const timer = setTimeout(() => {
        const chosen = st.pendingTerminal?.cue ?? cue;
        st.pendingTerminal = undefined;
        st.terminalFired = true;
        st.startedFired = false;
        void fire(chosen, sid, since);
      }, TERMINAL_SETTLE_MS);
      st.pendingTerminal = { cue, timer, since };
      return;
    }

    if (cue === 'waiting') {
      if (st.waiting) return;
      st.waiting = true;
      setTimeout(() => void fire('waiting', sid), TERMINAL_SETTLE_MS);
      return;
    }

    if (cue === 'retry') {
      if (now - st.lastRetryAt < 5000) return;
      st.lastRetryAt = now;
      void fire('retry', sid);
      return;
    }

    if (cue === 'toolError') {
      if (now - st.lastToolErrorAt < 3000) return;
      st.lastToolErrorAt = now;
      void fire('toolError', sid);
      return;
    }

    void fire(cue, sid); // compacted
  }

  ctx.subscriptions.push(
    ctx.events.onAgentEvent((event) => {
      const sid = event.sessionId;
      if (!sid) return;
      // Leaving the waiting phase re-arms the waiting cue.
      if (event.executionPhase && event.executionPhase !== 'waiting_user') {
        const st = sessions.get(sid);
        if (st) st.waiting = false;
      }
      if (event.kind === 'user' && !event.internal) onCue('started', sid);
      const cue = classify(event);
      if (cue && cue !== 'started') onCue(cue, sid);
      else if (cue === 'started' && event.kind !== 'user') onCue('started', sid);
    }),
  );

  ctx.subscriptions.push(
    ctx.notifications.onDidPost((n) => {
      if (n.kind === 'background-done' && n.sessionId) bgDone.set(n.sessionId, Date.now());
    }),
  );

  // Settings menu: status, mute toggle, preview each sound. The built-in "Settings" row is appended by Finch.
  const t = (key: string, values?: finch.TranslationValues) => ctx.i18n.t(key, values);
  const menu = ctx.settingsMenu.register({
    async getMenu() {
      const state = t(!enabled() ? 'state.off' : muted ? 'state.muted' : 'state.on');
      const previews: finch.ComposerActionMenuItem[] = CUE_EVENTS.filter((c) => soundFor(c)).map((c) => ({
        id: `preview:${c}`,
        label: t(`cue.${c}`),
        iconName: 'music',
      }));
      const items: finch.ComposerActionMenuItem[] = [
        { id: 'status', label: t('menu.status', { state }), disabled: true },
        muted
          ? { id: 'unmute', label: t('menu.unmute'), iconName: 'toggle-right' }
          : { id: 'mute', label: t('menu.mute'), iconName: 'toggle-left' },
      ];
      if (previews.length) {
        items.push({ id: 'preview', label: t('menu.preview'), iconName: 'music', children: previews });
      }
      items.push({ id: 'bird-preview', label: t('menu.bird'), iconName: 'bird' });
      return items;
    },
    async execute(_c, itemId) {
      if (itemId === 'mute' || itemId === 'unmute') {
        muted = itemId === 'mute';
        await ctx.storage.set('muted', muted);
        menu.notifyUpdate();
        void ctx.ui.showToast({ title: t(muted ? 'toast.muted' : 'toast.unmuted'), variant: 'success' });
        return;
      }
      if (itemId === 'bird-preview') {
        const r = await bird.show(undefined);
        if (r.note) void ctx.ui.showToast({ title: t('toast.birdFailed'), description: r.note, variant: 'warning' });
        return;
      }
      if (itemId.startsWith('preview:')) {
        const cue = itemId.slice('preview:'.length) as CueEvent;
        const file = soundFor(cue);
        if (!file) return;
        if (!play(file, true)) void ctx.ui.showToast({ title: t('toast.missingFile'), description: file, variant: 'warning' });
      }
    },
  });
  ctx.subscriptions.push(menu);

  ctx.subscriptions.push(
    ctx.tools.register({
      name: 'message_alert_preview',
      title: 'Message Alert Preview',
      description: `Preview Finch Message Alerts effects on this Mac.
This does not change any setting.

action:
  bird  — release the notch letter bird now (clicking it opens the current session); returns where the window was placed. Optional seconds overrides how long it stays, for this preview only
  sound — play the sound configured for one event (cue, default completed)`,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['bird', 'sound'] },
          cue: { type: 'string', enum: [...CUE_EVENTS], description: 'Event whose sound to play (sound only)' },
          seconds: { type: 'number', description: 'How long the bird stays, 5-60 (bird only; defaults to the setting)' },
        },
        required: ['action'],
      },
      risk: 'low',
      defaultEnabled: true,
      async execute(input, exec) {
        if (input.action === 'sound') {
          const cue = (CUE_EVENTS as readonly string[]).includes(String(input.cue)) ? (input.cue as CueEvent) : 'completed';
          const file = soundFor(cue);
          if (!file) return { content: [{ type: 'text', text: `${CUE_LABELS[cue]} is set to silent.` }] };
          const ok = play(file, true);
          return { content: [{ type: 'text', text: ok ? `Played ${CUE_LABELS[cue]}: ${file}` : `Sound file not found: ${file}` }], isError: !ok };
        }
        const sec = Number(input.seconds);
        const placed = await bird.show(exec.sessionId, Number.isFinite(sec) && sec > 0 ? Math.min(60, Math.max(5, sec)) : undefined);
        await new Promise((r) => setTimeout(r, 2500));
        const after = await bird.bounds();
        return {
          content: [{ type: 'text', text: JSON.stringify({ placed, boundsAfter2_5s: after ?? null }) }],
          isError: Boolean(placed.note && !placed.reusedWindow),
        };
      },
    }),
  );

  ctx.logger.info('message alerts activated');
}

export function deactivate(): void {}
