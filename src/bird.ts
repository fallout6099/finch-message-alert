import type * as finch from 'finch';
import { execFile } from 'node:child_process';
import { pickNotchGeometry, type NotchGeometry, type RawScreen } from './logic.js';

const W = 60; // window width (pt); height = menu bar height
const HOP_SPEED = 40; // pt/s while hopping — one hop (0.3 s) ≈ 12 pt
const FLY_SPEED = 170; // pt/s
const ROAM = 230; // how far left of the notch the bird wanders
// floating (3) + 22 = NSStatusWindowLevel (25): above the menu bar, still below open menus.
const ABOVE_MENU_BAR = 22;
/** Daily actions played at stops (ms); must match ACT_DUR in assets/bird-canvas.js. */
const ACT_MS: Record<string, number> = {
  stretch: 1500, yawn: 1500, sing: 2200, fluff: 900, mail: 1600, doze: 2800, dance: 1800,
};
const WAVE_MS = 1300; // greeting right after landing

function shuffled<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Reads every NSScreen and converts it to top-left coordinates.
const SCREEN_PROBE = [
  'ObjC.import("AppKit");',
  'var ss=$.NSScreen.screens,ph=ss.objectAtIndex(0).frame.size.height,o=[];',
  'for(var i=0;i<ss.count;i++){var s=ss.objectAtIndex(i),f=s.frame,v=s.visibleFrame;',
  'o.push({x:f.origin.x,y:ph-(f.origin.y+f.size.height),w:f.size.width,h:f.size.height,',
  'bar:(f.origin.y+f.size.height)-(v.origin.y+v.size.height),top:s.safeAreaInsets.top,',
  'll:s.auxiliaryTopLeftArea.size.width,rw:s.auxiliaryTopRightArea.size.width});}',
  'JSON.stringify(o)',
].join('');

function readScreens(): Promise<RawScreen[]> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', SCREEN_PROBE], { timeout: 4000 }, (err, out) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(String(out).trim()) as RawScreen[]); } catch (e) { reject(e); }
    });
  });
}

export interface BirdReport {
  readonly geometry?: NotchGeometry;
  readonly requested?: finch.CanvasBounds;
  readonly actual?: finch.CanvasBounds;
  readonly aboveMenuBar?: boolean;
  readonly reusedWindow?: boolean;
  readonly note?: string;
}

export interface NotchBird {
  show(sessionId?: string, staySeconds?: number): Promise<BirdReport>;
  bounds(): Promise<finch.CanvasBounds | undefined>;
  dispose(): void;
}

type Phase = 'idle' | 'emerge' | 'roam' | 'hover' | 'happy' | 'leave';

/** Finch mascot with a letter: pops out of the camera notch and hops along the menu bar to its left. */
export function createNotchBird(
  ctx: finch.MiniToolContext,
  opts: { seconds: () => number; onOpen: (sessionId: string) => void },
): NotchBird {
  let win: finch.CanvasWindow | undefined;
  let geo: NotchGeometry | undefined;
  let geoAt = 0;
  let sessionId: string | undefined;
  let count = 0;
  let x = 0;
  let phase: Phase = 'idle';
  let steps: NodeJS.Timeout[] = [];
  let stayTimer: NodeJS.Timeout | undefined;
  let gen = 0;
  // Actions come from a shuffled deck so none repeats until all have played (kept across releases).
  let deck: string[] = [];
  let lastAct = '';
  const nextAct = (): string => {
    if (!deck.length) {
      deck = shuffled(Object.keys(ACT_MS));
      if (deck[0] === lastAct) deck.push(deck.shift() as string);
    }
    lastAct = deck.shift() as string;
    return lastAct;
  };

  const post = (m: unknown) => { void win?.postMessage(m).catch(() => undefined); };
  const later = (ms: number, fn: () => void) => { steps.push(setTimeout(fn, ms)); };
  const clearSteps = () => { steps.forEach(clearTimeout); steps = []; };
  const clearStay = () => { if (stayTimer) clearTimeout(stayTimer); stayTimer = undefined; };
  const armStay = (sec = Math.max(5, opts.seconds())) => {
    clearStay();
    stayTimer = setTimeout(() => leave(), sec * 1000);
  };

  async function geometry(): Promise<NotchGeometry | undefined> {
    if (geo && Date.now() - geoAt < 60_000) return geo;
    try {
      const g = pickNotchGeometry(await readScreens());
      if (g) { geo = g; geoAt = Date.now(); }
    } catch (err) {
      ctx.logger.warn('screen probe failed', String(err));
    }
    return geo;
  }

  const g = () => geo as NotchGeometry;
  /** Window x with the whole bird tucked inside the notch. */
  const hiddenX = () => Math.round(g().hasNotch ? g().notchLeft + 12 : g().notchLeft - W / 2);
  const minX = () => Math.round(Math.max(g().screenX + 8, g().notchLeft - ROAM));
  /** Rightmost stop: the beak just touches the notch edge. */
  const maxX = () => Math.round(g().notchLeft - W / 2 - 8);

  function moveTo(tx: number, speed: number, kind: 'linear' | 'spring' = 'linear'): number {
    const durationMs = Math.max(250, Math.round((Math.abs(tx - x) / speed) * 1000));
    // 'all-displays' keeps the menu-bar strip reachable; the default clamps to the work area (below the bar).
    win?.startMotion({ kind, to: { x: tx, y: g().screenY }, durationMs, bounds: 'all-displays' });
    x = tx;
    return durationMs;
  }

  async function syncX(): Promise<void> {
    const b = await win?.getBounds().catch(() => undefined);
    if (b) x = Math.round(b.x);
  }

  function emerge(): void {
    phase = 'emerge';
    // 1. hop until the head (and the letter) pokes out of the notch
    post({ type: 'mode', mode: 'hop', dir: -1 });
    const d1 = moveTo(Math.round(g().notchLeft - W / 2 + (g().hasNotch ? 4 : 0)), HOP_SPEED * 0.8);
    later(d1, () => {
      // 2. peek: stand, blink, look around
      post({ type: 'mode', mode: 'stand', dir: -1 });
      later(800, () => {
        // 3. flutter out and land
        post({ type: 'mode', mode: 'fly', dir: -1 });
        const d2 = moveTo(Math.round(g().notchLeft - W - 50), FLY_SPEED * 0.6);
        later(d2, () => {
          post({ type: 'land' });
          phase = 'roam';
          // 4. say hi with a wing wave, then start wandering
          later(350, () => post({ type: 'act', name: 'wave' }));
          later(350 + WAVE_MS + 300, roam);
        });
      });
    });
  }

  function roam(): void {
    if (!win || phase !== 'roam') return;
    const lo = minX();
    const hi = Math.max(lo, maxX());
    // mostly short hops (35–90 pt); now and then a long trip, flown when it is far
    const long = Math.random() < 0.3;
    let tx = x;
    for (let i = 0; i < 12; i++) {
      const cand = long
        ? Math.round(lo + Math.random() * (hi - lo))
        : Math.round(x + (Math.random() < 0.5 ? -1 : 1) * (35 + Math.random() * 55));
      if (cand >= lo && cand <= hi && Math.abs(cand - x) >= 35) { tx = cand; break; }
    }
    if (tx === x) tx = x - lo > hi - x ? Math.max(lo, x - 60) : Math.min(hi, x + 60);
    const fly = Math.abs(tx - x) > 110;
    post({ type: 'mode', mode: fly ? 'fly' : 'hop', dir: tx < x ? -1 : 1 });
    const d = moveTo(tx, fly ? FLY_SPEED * 0.5 : HOP_SPEED);
    later(d, () => {
      post(fly ? { type: 'land' } : { type: 'mode', mode: 'stand' });
      const settle = fly ? 350 : 150;
      if (Math.random() < 0.8) { // most stops play a daily action
        const name = nextAct();
        later(settle, () => post({ type: 'act', name }));
        later(settle + (ACT_MS[name] ?? 1500) + 300 + Math.random() * 600, roam);
      } else {
        later(700 + Math.random() * 1200, roam);
      }
    });
  }

  function leave(fast = false): void {
    const w = win;
    if (!w || phase === 'leave') return;
    phase = 'leave';
    clearSteps();
    clearStay();
    w.stopMotion();
    void syncX().then(() => {
      if (win !== w) return;
      if (!g().hasNotch) {
        post({ type: 'mode', mode: 'fly' });
        post({ type: 'vanish' });
        later(600, close);
        return;
      }
      post({ type: 'mode', mode: 'fly', dir: 1 }); // fly back into the notch
      const d = moveTo(hiddenX(), fast ? FLY_SPEED * 1.4 : FLY_SPEED);
      later(d + 150, close);
    });
  }

  function close(): void {
    clearSteps();
    clearStay();
    const w = win;
    win = undefined;
    phase = 'idle';
    count = 0;
    w?.dispose();
  }

  function onMessage(w: finch.CanvasWindow, m: unknown): void {
    if (win !== w) return;
    const msg = m as { type?: string; on?: boolean };
    if (msg?.type === 'click') {
      if (phase === 'leave' || phase === 'happy') return;
      phase = 'happy';
      clearSteps();
      clearStay();
      w.stopMotion();
      post({ type: 'happy' });
      if (sessionId) opts.onOpen(sessionId);
      later(520, () => leave(true));
    } else if (msg?.type === 'hover') {
      if (msg.on && phase === 'roam') {
        phase = 'hover';
        clearSteps();
        clearStay();
        w.stopMotion();
        void syncX();
        post({ type: 'mode', mode: 'stand' });
      } else if (!msg.on && phase === 'hover') {
        phase = 'roam';
        armStay(5);
        later(500, roam);
      }
    }
  }

  /** Dispose a half-created window (openWindow assigns `win` before awaiting ready). */
  function dropWindow(): void {
    const w = win as finch.CanvasWindow | undefined;
    win = undefined;
    w?.dispose();
  }

  async function openWindow(geom: NotchGeometry, aboveMenuBar: boolean): Promise<finch.CanvasWindow> {
    const w = ctx.ui.createCanvasWindow({
      entry: 'assets/bird-canvas.js',
      width: W,
      height: geom.barH,
      x: hiddenX(),
      y: geom.screenY,
      alwaysOnTop: true,
      alwaysOnTopLevel: 'floating',
      ...(aboveMenuBar ? { alwaysOnTopRelativeLevel: ABOVE_MENU_BAR } : {}),
      transparent: true,
      clickThrough: false,
      opacity: 0, // revealed only after it sits at the notch
      hiddenInMissionControl: true,
      visibleOnAllWorkspaces: true,
      frameRate: 60,
      constraint: 'none',
      // allowOffscreen is deprecated in favour of constraint: 'none', but Finch 1.8.0 only maps
      // allowOffscreen to Electron's enableLargerThanScreen; without it macOS' constrainFrameRect
      // pushes the window's top edge below the menu bar. Keep both until Finch maps constraint too.
      allowOffscreen: true,
      maxDevicePixelRatio: 2,
      initialData: { count, dir: -1 },
    });
    win = w;
    w.onDidReceiveMessage((m) => onMessage(w, m));
    w.onDidDispose(() => {
      if (win === w) { clearSteps(); clearStay(); win = undefined; phase = 'idle'; count = 0; }
    });
    await Promise.race([
      w.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('bird window timed out')), 8000)),
    ]);
    return w;
  }

  async function show(sid?: string, staySeconds?: number): Promise<BirdReport> {
    if (win && phase !== 'leave') {
      if (sid) sessionId = sid;
      count += 1;
      post({ type: 'letters', count });
      if (phase !== 'hover' && phase !== 'happy') armStay(); // a new letter extends the stay
      return { geometry: geo, reusedWindow: true };
    }
    if (win) close();
    if (typeof ctx.api?.supports === 'function' && !ctx.api.supports('ui.createCanvasWindow')) {
      return { note: 'This Finch version has no canvas windows.' };
    }
    const geom = await geometry();
    if (!geom) return { note: 'Could not read screen geometry.' };
    const myGen = ++gen;
    sessionId = sid;
    count = 1;

    let w: finch.CanvasWindow | undefined;
    let aboveMenuBar = true;
    try {
      w = await openWindow(geom, true);
    } catch (err) {
      ctx.logger.warn('bird above menu bar failed, retrying at floating level', String(err));
      dropWindow();
      aboveMenuBar = false;
      try { w = await openWindow(geom, false); } catch (err2) {
        dropWindow();
        return { geometry: geom, note: `bird window failed: ${String(err2)}` };
      }
    }
    if (gen !== myGen || win !== w) return { geometry: geom, note: 'superseded' };

    x = hiddenX();
    const requested = { x, y: geom.screenY, width: W, height: geom.barH };
    await w.update({ bounds: requested, opacity: 1, visible: true });
    const actual = await w.getBounds().catch(() => undefined);
    emerge();
    armStay(staySeconds);
    return { geometry: geom, requested, actual, aboveMenuBar };
  }

  return {
    show,
    bounds: async () => win?.getBounds().catch(() => undefined),
    dispose: close,
  };
}
