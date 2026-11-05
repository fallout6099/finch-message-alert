// Pure logic for Finch Message Alerts — no Finch runtime imports so it can be unit-tested directly.

export type CueEvent =
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'waiting'
  | 'started'
  | 'retry'
  | 'compacted'
  | 'toolError';

export const CUE_EVENTS: readonly CueEvent[] = [
  'completed',
  'interrupted',
  'failed',
  'waiting',
  'started',
  'retry',
  'compacted',
  'toolError',
];

/** English names for tool results (model-facing). User-facing labels live in i18n/<locale>.json as cue.<event>. */
export const CUE_LABELS: Record<CueEvent, string> = {
  completed: 'Task completed',
  interrupted: 'Task interrupted',
  failed: 'Failed',
  waiting: 'Waiting for you',
  started: 'Task started',
  retry: 'Auto retry',
  compacted: 'Context compacted',
  toolError: 'Tool error',
};

export const DEFAULT_SOUNDS: Record<CueEvent, string> = {
  completed: 'Glass',
  interrupted: 'Pop',
  failed: 'Basso',
  waiting: 'Ping',
  started: 'none',
  retry: 'none',
  compacted: 'none',
  toolError: 'none',
};

export const SYSTEM_SOUNDS = [
  'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero',
  'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink',
] as const;

/** Terminal cues share one slot per run: the strongest one wins. */
export const TERMINAL_PRIORITY: Partial<Record<CueEvent, number>> = {
  completed: 1,
  failed: 2,
  interrupted: 3,
};

/** Minimal shape of the AgentEvent fields we read. */
export interface EventLike {
  readonly kind: string;
  readonly sessionId?: string;
  readonly executionPhase?: string;
  readonly isRetryable?: boolean;
  readonly isToolError?: boolean;
  readonly compactionPhase?: 'start' | 'end';
  readonly internal?: boolean;
}

/** Map one Agent event to a cue, or undefined when it is not interesting. */
export function classify(event: EventLike): CueEvent | undefined {
  if (event.internal) return undefined;
  switch (event.executionPhase) {
    case 'completed': return 'completed';
    case 'interrupted': return 'interrupted';
    case 'failed': return 'failed';
    case 'waiting_user': return 'waiting';
    case 'retry_wait': return 'retry';
    case 'starting': return 'started';
    default: break;
  }
  switch (event.kind) {
    case 'result': return 'completed';
    case 'interrupted': return 'interrupted';
    case 'error': return event.isRetryable ? undefined : 'failed';
    case 'permission_request': return 'waiting';
    case 'compact_boundary': return event.compactionPhase === 'start' ? undefined : 'compacted';
    case 'tool_result': return event.isToolError ? 'toolError' : undefined;
    default: return undefined;
  }
}

/** Parse "HH:MM-HH:MM" (may wrap past midnight). Returns true when `now` falls inside. */
export function inQuietHours(spec: string | undefined, now: Date): boolean {
  if (!spec) return false;
  const m = spec.trim().match(/^(\d{1,2}):(\d{2})\s*[-~—–至到]\s*(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  const cur = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/** Resolve the configured sound to a playable file path, or undefined for silence. */
export function resolveSoundPath(
  choice: string | undefined,
  customPath: string | undefined,
  home: string,
  soundsDir = '',
): string | undefined {
  const c = (choice ?? '').trim();
  if (!c || c === 'none') return undefined;
  if (c.startsWith('fun:')) {
    const name = c.slice(4).replace(/[^a-z0-9-]/gi, '');
    return name ? `${soundsDir.replace(/\/$/, '')}/${name}.wav` : undefined;
  }
  if (c === 'custom') {
    const p = (customPath ?? '').trim();
    if (!p) return undefined;
    return p.startsWith('~/') ? home + p.slice(1) : p;
  }
  return `/System/Library/Sounds/${c}.aiff`;
}

/** afplay volume: 0..1 is normal range; clamp the 0..100 slider. */
export function toAfplayVolume(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0.6;
  return Math.max(0, Math.min(100, n)) / 100;
}

/** One screen as reported by the NSScreen probe, already in top-left (Electron) coordinates. */
export interface RawScreen {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Menu bar height (frame top − visibleFrame top); 0 when the menu bar auto-hides. */
  readonly bar: number;
  /** safeAreaInsets.top — the notch height, 0 without a notch. */
  readonly top: number;
  /** Width of auxiliaryTopLeftArea / auxiliaryTopRightArea. */
  readonly ll: number;
  readonly rw: number;
}

export interface NotchGeometry {
  readonly screenX: number;
  readonly screenY: number;
  readonly screenW: number;
  readonly barH: number;
  readonly notchLeft: number;
  readonly notchRight: number;
  readonly hasNotch: boolean;
}

/** Prefer the screen with a camera notch; otherwise fall back to the primary screen's centre. */
export function pickNotchGeometry(screens: readonly RawScreen[]): NotchGeometry | undefined {
  const valid = screens.filter((s) => s && s.w > 0 && s.h > 0);
  if (!valid.length) return undefined;
  const notched = valid.find((s) => s.ll > 0 && s.rw > 0 && s.top > 0 && s.ll + s.rw < s.w - 20);
  const s = notched ?? valid[0];
  const barH = Math.round(s.bar > 10 ? s.bar : s.top > 10 ? s.top : 24);
  const base = { screenX: s.x, screenY: s.y, screenW: s.w, barH };
  if (notched) {
    return { ...base, notchLeft: s.x + s.ll, notchRight: s.x + s.w - s.rw, hasNotch: true };
  }
  const c = s.x + s.w / 2;
  return { ...base, notchLeft: c, notchRight: c, hasNotch: false };
}
