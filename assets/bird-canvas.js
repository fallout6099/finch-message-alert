// Finch mascot with a crossbody mail bag — runs inside Finch's Canvas window shell.
// All art is vector paths authored in a 512-unit space that matches the Finch app icon
// (bird faces right, toes on y = 430), then scaled to fit the menu-bar strip.
(function () {
  'use strict';

  const ART = {
    body: 'M400 190C398 160 372 128 322 122C270 117 238 148 226 186C214 228 192 264 154 292C128 311 104 320 86 327C118 348 160 366 210 377C240 383 272 385 302 385C352 385 392 360 404 318C414 282 410 226 400 190Z',
    face: 'M398 154C352 152 312 162 296 192C280 224 276 282 284 328C289 358 298 378 310 394L490 394L490 154Z',
    wing: 'M290 206C252 222 210 262 168 292C138 313 110 323 86 327C120 348 168 368 222 379C252 385 286 386 304 385C290 352 280 300 284 256C286 236 288 220 290 206Z',
    feathers: 'M286 258C246 272 196 304 122 331M292 318C254 332 212 350 168 362',
    beakUp: 'M380 146C408 145 432 152 452 166C432 172 412 176 392 182Z',
    beakLo: 'M392 180C410 178 426 177 440 178C428 188 412 196 396 200Z',
    strap: 'M246 114C278 188 312 254 334 312',
    // bag parts are drawn relative to PIVOT_BAG (where the strap meets the bag)
    bag: 'M-44 -2H44Q58 -2 58 12V62Q58 78 42 78H-42Q-58 78 -58 62V12Q-58 -2 -44 -2Z',
    flap: 'M-50 -8H50Q62 -8 62 4V26Q62 40 46 42L0 50L-46 42Q-62 40 -62 26V4Q-62 -8 -50 -8Z',
    mail: 'M-30 -44H30Q36 -44 36 -38V6H-36V-38Q-36 -44 -30 -44Z',
    mailV: 'M-33 -41L0 -20L33 -41',
  };
  const PIVOT_WING = [292, 222];
  const PIVOT_BAG = [334, 312];
  const HINGE = [390, 178];
  const HOP_T = 0.3; // seconds per hop
  const HOP_H = 3.2; // hop height (pt)
  const TURN_T = 0.16;
  // Seconds per daily action; bird.ts keeps the same table to schedule them.
  const ACT_DUR = {
    wave: 1.3, stretch: 1.5, yawn: 1.5, sing: 2.2, fluff: 0.9,
    mail: 1.6, doze: 2.8, dance: 1.8, look: 1.0, glance: 0.9,
  };

  let api, canvas, ctx, W = 60, H = 33, k = 0.08;
  let P = null, G = null;

  const S = {
    mode: 'stand', dir: -1, turnFrom: -1, turnT: 1,
    t: 0, hopPh: 0, flapPh: 0, happy: 0, landT: 0,
    air: 0, tilt: 0, sqx: 1, sqy: 1, wing: 0, legs: 'stand',
    beak: 0, peek: 0, eyes: 'open', bagBase: 0,
    blink: 0, blinkIn: 1.4, double: false,
    act: null, actT: 0, actIn: 2.5, glanceBack: 0,
    bt: 0, bv: 0, ft: 0, fv: 0,
    alpha: 0, vanish: false,
    count: 1, hover: false, hoverIdle: 0, clicked: false,
    badge: null, fx: [],
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const approach = (cur, tgt, rate, s) => cur + (tgt - cur) * Math.min(1, rate * s);
  const bump = (t, d) => (t > 0 && t < d ? Math.sin((Math.PI * t) / d) : 0);
  const smooth = (x) => x * x * (3 - 2 * x);
  /** Trapezoid envelope: eases in over `a` s, holds, eases out over the last `b` s of `d`. */
  const env = (t, d, a, b) => smooth(clamp(Math.min(t / a, (d - t) / b), 0, 1));

  function lin(x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  }

  function buildArt() {
    P = {};
    for (const key in ART) P[key] = new Path2D(ART[key]);
    G = {
      body: lin(0, 118, 0, 388, [[0, '#b6eedb'], [0.42, '#7dd2b4'], [1, '#3f9f83']]),
      wing: lin(0, 205, 0, 386, [[0, '#76cbad'], [1, '#2a876c']]),
      far: lin(0, 205, 0, 386, [[0, '#4fae90'], [1, '#1f6e57']]),
      face: lin(0, 150, 0, 390, [[0, '#ffffff'], [0.72, '#f6fbf9'], [1, '#d6ede4']]),
      beak: lin(380, 146, 452, 200, [[0, '#4fb394'], [1, '#22765e']]),
      paper: lin(0, -44, 0, 6, [[0, '#fffdf6'], [1, '#f1e7d2']]),
      bag: lin(0, -2, 0, 78, [[0, '#f6c27e'], [1, '#c9783a']]),
      flap: lin(0, -8, 0, 50, [[0, '#d0813f'], [1, '#9c5224']]),
    };
  }

  function setDir(d) {
    d = d < 0 ? -1 : 1;
    if (d === S.dir) return;
    const cur = S.turnT < 1 ? S.turnFrom * (1 - 2 * easeInOut(S.turnT)) : S.dir;
    S.turnFrom = cur >= 0 ? 1 : -1;
    S.dir = d;
    S.turnT = S.turnFrom === d ? 1 : 0;
    S.bv += 1.2; // the bag swings when the bird turns
  }

  // ---- particles (screen space) ----
  const beakX = () => W / 2 + S.dir * k * 150;
  const headY = () => H - 2 - S.air - k * 290;

  function spark(n, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (1.05 + Math.random() * 0.9);
      const v = 14 + Math.random() * 22;
      S.fx.push({
        kind: 'star', x: W / 2 + S.dir * (Math.random() * 10 - 2), y: H - 4 - Math.random() * 6,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, g: 30,
        life, max: life, r: 1.2 + Math.random() * 1.2,
        c: Math.random() < 0.5 ? '#c9f5e5' : '#ffffff',
      });
    }
  }
  function note() {
    S.fx.push({
      kind: 'note', x: beakX() + S.dir * 2, y: headY() + 5,
      vx: S.dir * (5 + Math.random() * 4), vy: -6 - Math.random() * 3, g: 0,
      life: 1.1, max: 1.1, r: 1, c: Math.random() < 0.5 ? '#ffffff' : '#c9f5e5', w: Math.random() * 6,
    });
  }
  function zzz() {
    S.fx.push({
      kind: 'z', x: beakX() - S.dir * 3, y: headY() + 3,
      vx: S.dir * 3.5, vy: -5, g: 0, life: 1.3, max: 1.3, r: 1, c: '#d8f1ff', w: 0,
    });
  }
  function puff(n) {
    const cy = H - 2 - S.air - k * 160;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 10 + Math.random() * 12;
      S.fx.push({
        kind: 'puff', x: W / 2 + Math.cos(a) * 6, y: cy + Math.sin(a) * 5,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, g: 22,
        life: 0.55, max: 0.55, r: 0.8 + Math.random() * 0.6, c: Math.random() < 0.6 ? '#9fe0c8' : '#ffffff',
      });
    }
  }

  function land(strength) {
    S.bv += 2.6 * strength;
    S.fv -= 2.2 * strength;
    if (strength >= 1) {
      S.landT = 0.2;
      spark(8, 0.5);
    }
  }

  function startAct(name) {
    if (!ACT_DUR[name]) return;
    S.act = name;
    S.actT = 0;
    if (name === 'glance') setDir(-S.dir);
    if (name === 'fluff') { S.bv += 3.5; S.fv -= 3; }
    if (name === 'mail' || name === 'wave') S.bv += 1.8;
  }

  /** Pose overrides for the running daily action; also fires its one-off effects. */
  function actPose(s, o) {
    const p = S.actT;
    const d = ACT_DUR[S.act];
    const t = (S.actT += s);
    const hit = (x) => p < x && t >= x;
    switch (S.act) {
      case 'look': o.tilt = -0.17 * bump(t, d); break;
      case 'glance': if (hit(0.75)) setDir(-S.dir); break;
      case 'wave': { // greeting: wing waves up and down
        const e = env(t, d, 0.15, 0.2);
        o.wing = e * (0.5 + 0.32 * Math.sin(t * 18));
        o.tilt = -0.06 * e;
        o.eyes = 'happy';
        break;
      }
      case 'stretch': { // 伸懒腰: wing up, body long, eyes shut
        const e = env(t, d, 0.4, 0.35);
        o.wing = 1.0 * e;
        o.sqy += 0.08 * e; o.sqx = 1 - 0.05 * e;
        o.tilt = -0.12 * e;
        if (e > 0.6) o.eyes = 'shut';
        if (hit(d - 0.3)) S.bv += 1.5;
        break;
      }
      case 'yawn': { // 打哈欠
        const e = env(t, d, 0.35, 0.35);
        o.beak = 0.55 * e;
        o.tilt = -0.18 * e;
        o.sqy += 0.05 * e;
        if (e > 0.35) o.eyes = 'shut';
        break;
      }
      case 'sing': { // 哼歌: beak chatters, little notes float out
        const e = env(t, d, 0.2, 0.25);
        o.beak = e * (0.14 + 0.14 * Math.sin(t * Math.PI * 2 * 3.2));
        o.tilt = e * (-0.09 + 0.06 * Math.sin(t * Math.PI * 2 * 1.1));
        o.air = e * 0.7 * Math.abs(Math.sin(t * Math.PI * 2.2));
        o.eyes = 'happy';
        for (const x of [0.15, 0.55, 0.95, 1.35, 1.75]) if (hit(x)) note();
        break;
      }
      case 'fluff': { // 抖羽毛
        const e = bump(t, d);
        o.sqx = 1 + 0.11 * e + 0.035 * e * Math.sin(t * 75);
        o.sqy += 0.08 * e;
        if (e > 0.4) o.eyes = 'shut';
        if (hit(0.4)) puff(8);
        break;
      }
      case 'mail': { // 掏出信晃一晃: a letter rises out of the bag
        const e = env(t, d, 0.3, 0.3);
        o.peek = e;
        o.tilt = -0.08 * e;
        o.eyes = e > 0.5 ? 'happy' : 'open';
        if (hit(d - 0.3)) S.bv += 2;
        break;
      }
      case 'doze': { // 打个盹, then wakes with a start
        const e = env(t, d, 0.4, 0.15);
        const wakeAt = d - 0.35;
        o.eyes = e > 0.3 && t < wakeAt ? 'shut' : 'open';
        o.tilt = 0.05 * e + 0.025 * e * Math.sin(t * 2.6);
        o.sqy += -0.05 * e + 0.02 * e * Math.sin(t * 2.6);
        o.sqx = 1 + 0.04 * e;
        o.air = 2.4 * bump(t - wakeAt, 0.35);
        for (const x of [0.6, 1.25, 1.9]) if (hit(x)) zzz();
        if (hit(wakeAt)) { S.bv += 3; S.fv -= 2; }
        break;
      }
      case 'dance': { // 摇摆: sways on the beat and turns around twice
        const e = env(t, d, 0.2, 0.2);
        const w = Math.sin(t * Math.PI * 2 * 2.4);
        o.tilt = e * 0.13 * w;
        o.air = e * 1.6 * Math.abs(w);
        o.sqx = 1 + 0.04 * e * w;
        o.eyes = 'happy';
        if (hit(0.62) || hit(1.25)) setDir(-S.dir);
        break;
      }
      default: break;
    }
    if (t >= d) {
      S.act = null;
      S.actIn = 1.8 + Math.random() * 2;
    }
    return o;
  }

  function update(s) {
    S.t += s;
    S.alpha = approach(S.alpha, S.vanish ? 0 : 1, S.vanish ? 9 : 12, s);
    if (S.turnT < 1) S.turnT = Math.min(1, S.turnT + s / TURN_T);

    // blink (sometimes twice)
    if (S.blink > 0) S.blink = Math.max(0, S.blink - s);
    else if ((S.blinkIn -= s) <= 0) {
      S.blink = 0.13;
      S.blinkIn = S.double ? 0.2 : 1.8 + Math.random() * 3;
      S.double = !S.double && Math.random() < 0.3;
    }

    // springs: bag swing (bt) and wing/tail flick (ft)
    S.bv += (-80 * S.bt - 5.5 * S.bv) * s; S.bt += S.bv * s;
    S.fv += (-120 * S.ft - 9 * S.fv) * s; S.ft += S.fv * s;

    const o = { air: 0, tilt: 0, sqx: 1, sqy: 1, wing: 0, beak: 0, peek: 0, eyes: 'open' };
    let legs = 'stand', snap = false, bagBase = 0;
    switch (S.mode) {
      case 'hop': {
        const prev = S.hopPh;
        S.hopPh += s / HOP_T;
        if (Math.floor(S.hopPh) !== Math.floor(prev)) land(0.55);
        const f = S.hopPh % 1;
        o.air = Math.sin(Math.PI * f) * HOP_H;
        legs = f > 0.14 && f < 0.86 ? 'tuck' : 'stand';
        const sq = f < 0.12 ? 1 - f / 0.12 : f > 0.92 ? (f - 0.92) / 0.08 : 0;
        o.sqy = 1 - 0.1 * sq + 0.04 * Math.sin(Math.PI * f);
        o.sqx = 1 + 0.08 * sq - 0.02 * Math.sin(Math.PI * f);
        o.tilt = 0.06 + 0.06 * Math.sin(Math.PI * 2 * f);
        o.wing = 0.08 * Math.sin(Math.PI * f);
        bagBase = 0.1;
        snap = true;
        break;
      }
      case 'fly': {
        S.flapPh += s * Math.PI * 2 * 8.5;
        const u = 0.5 + 0.5 * Math.sin(S.flapPh);
        o.wing = -0.25 + 1.12 * u;
        o.air = 3 + Math.sin(S.t * 5) * 0.7 + (u - 0.5) * 0.9;
        legs = 'tuck';
        o.tilt = 0.12;
        bagBase = 0.45; // the bag trails behind in flight
        break;
      }
      case 'happy': {
        S.happy += s;
        const p = Math.min(1, S.happy / 0.5);
        S.flapPh += s * Math.PI * 2 * 10;
        o.wing = -0.2 + 1.25 * (0.5 + 0.5 * Math.sin(S.flapPh));
        o.air = Math.sin(Math.PI * p) * 6;
        legs = p < 0.85 ? 'tuck' : 'stand';
        o.tilt = -0.16 * Math.sin(Math.PI * p);
        o.peek = 1;
        o.eyes = 'happy';
        snap = true;
        if (p >= 1) { S.mode = 'stand'; land(1); }
        break;
      }
      default: {
        o.sqy = 1 + Math.sin(S.t * 3.2) * 0.014; // breathing
        if (S.hover) {
          o.tilt = -0.13; // look up at the cursor and show the letter
          o.peek = 1;
          S.bt += Math.sin(S.t * 14) * 0.003;
        } else if (S.act) {
          actPose(s, o);
          if (o.air > 0) snap = true;
        } else if ((S.actIn -= s) <= 0) {
          startAct(Math.random() < 0.6 ? 'look' : 'glance'); // small idle fidgets between scheduled actions
          S.actIn = 2.2 + Math.random() * 2.5;
        }
      }
    }
    if (S.landT > 0) {
      const q = S.landT / 0.2;
      o.sqy -= 0.15 * q; o.sqx += 0.1 * q;
      S.landT = Math.max(0, S.landT - s);
    }

    const flapping = S.mode === 'fly' || S.mode === 'happy';
    S.air = snap ? o.air : approach(S.air, o.air, 14, s);
    S.tilt = approach(S.tilt, o.tilt, 16, s);
    S.wing = flapping ? o.wing : approach(S.wing, o.wing, 14, s);
    S.beak = approach(S.beak, o.beak, 22, s);
    S.peek = approach(S.peek, o.peek, 10, s);
    S.bagBase = approach(S.bagBase, bagBase, 8, s);
    S.sqx = o.sqx; S.sqy = o.sqy; S.legs = legs; S.eyes = o.eyes;

    if (S.hover && (S.hoverIdle += s) > 0.8) {
      S.hover = false;
      api.postMessage({ type: 'hover', on: false });
    }

    for (const p of S.fx) {
      p.life -= s; p.x += p.vx * s; p.y += p.vy * s; p.vy += p.g * s;
      if (p.kind === 'note' || p.kind === 'z') p.vx *= 1 - 1.2 * s;
    }
    S.fx = S.fx.filter((p) => p.life > 0);
  }

  function drawLegs() {
    ctx.strokeStyle = '#f2a35e';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const [hx, hy] of [[286, 374], [318, 378]]) {
      if (S.legs === 'tuck') {
        ctx.moveTo(hx, hy); ctx.lineTo(hx + 9, hy + 22); ctx.lineTo(hx - 8, hy + 34);
        ctx.moveTo(hx - 8, hy + 34); ctx.lineTo(hx + 8, hy + 38);
      } else {
        ctx.moveTo(hx, hy); ctx.lineTo(hx - 5, 404); ctx.lineTo(hx - 1, 428);
        ctx.moveTo(hx - 12, 430); ctx.lineTo(hx + 20, 430);
        ctx.moveTo(hx + 2, 429); ctx.lineTo(hx + 14, 420);
      }
    }
    ctx.stroke();
  }

  function rotateAbout([px, py], a) {
    ctx.translate(px, py); ctx.rotate(a); ctx.translate(-px, -py);
  }

  function drawEye() {
    ctx.fillStyle = 'rgba(255,128,140,0.4)';
    ctx.beginPath(); ctx.ellipse(376, 238, 16, 10, 0, 0, Math.PI * 2); ctx.fill();
    const open = S.eyes !== 'open' ? 0 : S.blink > 0 ? Math.abs(1 - 2 * (S.blink / 0.13)) : 1;
    ctx.fillStyle = '#11302b';
    ctx.strokeStyle = '#11302b';
    ctx.lineCap = 'round';
    if (S.eyes === 'happy') { // ^ smiling eye
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(336, 208); ctx.quadraticCurveTo(350, 188, 364, 208); ctx.stroke();
    } else if (open < 0.3) { // closed, relaxed
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(337, 202); ctx.quadraticCurveTo(350, 212, 363, 202); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(350, 201, 14, 14 * open, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(355, 195 + (1 - open) * 4, 4.8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha *= 0.7;
      ctx.beginPath(); ctx.arc(345, 207, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha /= 0.7;
    }
  }

  function drawBeak() {
    const a = S.beak;
    const [hx, hy] = HINGE;
    if (a > 0.02) { // open mouth: dark wedge between the beaks
      ctx.fillStyle = '#7a2a3a';
      ctx.beginPath();
      ctx.moveTo(384, 170);
      ctx.lineTo(452, 164 - a * 14);
      ctx.lineTo(hx + 54 * Math.cos(a), hy + 2 + 54 * Math.sin(a));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = G.beak;
    ctx.save(); rotateAbout(HINGE, a); ctx.fill(P.beakLo); ctx.restore();
    ctx.save(); rotateAbout(HINGE, -a * 0.3);
    ctx.fill(P.beakUp);
    ctx.strokeStyle = 'rgba(10,40,34,0.45)';
    ctx.lineWidth = 4;
    ctx.stroke(P.beakUp);
    ctx.restore();
  }

  function drawBag(r) {
    ctx.save();
    ctx.translate(PIVOT_BAG[0], PIVOT_BAG[1]);
    ctx.rotate(S.bagBase + S.bt);
    if (S.peek > 0.02) { // the letter rises out of the bag
      ctx.save();
      ctx.translate(0, (1 - S.peek) * 46);
      ctx.fillStyle = G.paper; ctx.fill(P.mail);
      ctx.strokeStyle = '#cdbd9e'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.stroke(P.mail); ctx.stroke(P.mailV);
      ctx.fillStyle = '#ff6b62';
      ctx.beginPath(); ctx.arc(0, -21, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(70,30,8,0.6)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.fillStyle = G.bag; ctx.fill(P.bag); ctx.stroke(P.bag);
    ctx.fillStyle = G.flap; ctx.fill(P.flap); ctx.stroke(P.flap);
    ctx.fillStyle = '#ffd36b';
    ctx.beginPath(); ctx.roundRect(-10, 34, 20, 16, 5); ctx.fill();
    ctx.lineWidth = 3.5; ctx.stroke();
    const m = ctx.getTransform().transformPoint(new DOMPoint(48, -6));
    S.badge = [m.x / r, m.y / r];
    ctx.restore();
  }

  function drawBird(cx, footY, face, r) {
    ctx.save();
    ctx.translate(cx, footY);
    ctx.scale(face * S.sqx, S.sqy);
    ctx.rotate(S.tilt);
    ctx.scale(k, k);
    ctx.translate(-300, -430);

    const flapping = S.mode === 'fly' || S.mode === 'happy';
    if ((flapping || S.wing > 0.5) && S.wing > 0.15) { // far wing peeks above the back
      ctx.save();
      rotateAbout(PIVOT_WING, S.wing * 0.85 + 0.1);
      ctx.translate(14, -10);
      ctx.fillStyle = G.far;
      ctx.fill(P.wing);
      ctx.restore();
    }

    drawLegs();

    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(10,40,34,0.55)';
    ctx.stroke(P.body);
    ctx.fillStyle = G.body;
    ctx.fill(P.body);

    ctx.save();
    ctx.clip(P.body);
    ctx.fillStyle = G.face;
    ctx.fill(P.face);
    ctx.restore();

    ctx.save();
    rotateAbout(PIVOT_WING, S.wing + S.ft * 0.5);
    ctx.fillStyle = G.wing;
    ctx.fill(P.wing);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.stroke(P.feathers);
    ctx.restore();

    // crossbody strap: over the shoulder, across the chest, down to the bag
    ctx.save();
    ctx.clip(P.body);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#9a5626';
    ctx.lineWidth = 17;
    ctx.stroke(P.strap);
    ctx.strokeStyle = 'rgba(255,214,160,0.45)';
    ctx.lineWidth = 4;
    ctx.stroke(P.strap);
    ctx.restore();

    drawEye();
    drawBeak();
    drawBag(r);
    ctx.restore();
  }

  function drawStar(x, y, r, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2); ctx.quadraticCurveTo(x, y, x + r * 2, y);
    ctx.quadraticCurveTo(x, y, x, y + r * 2); ctx.quadraticCurveTo(x, y, x - r * 2, y);
    ctx.quadraticCurveTo(x, y, x, y - r * 2);
    ctx.fill();
  }

  function drawNote(p) {
    const x = p.x + Math.sin(S.t * 6 + p.w) * 0.8;
    ctx.fillStyle = p.c; ctx.strokeStyle = p.c;
    ctx.beginPath(); ctx.ellipse(x, p.y, 1.5, 1.1, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 0.7; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 1.3, p.y - 0.3); ctx.lineTo(x + 1.3, p.y - 5);
    ctx.quadraticCurveTo(x + 2.2, p.y - 3.2, x + 3.4, p.y - 3);
    ctx.stroke();
  }

  function drawFx(p) {
    const floaty = p.kind === 'note' || p.kind === 'z'; // fade in fast, stay bright, fade out late
    ctx.globalAlpha = S.alpha * (floaty
      ? clamp((p.max - p.life) / 0.12, 0, 1) * clamp(p.life / (p.max * 0.45), 0, 1)
      : clamp(p.life / p.max, 0, 1));
    if (p.kind === 'note') drawNote(p);
    else if (p.kind === 'z') {
      const size = 3.6 + 2.6 * (1 - p.life / p.max);
      ctx.fillStyle = p.c;
      ctx.font = `800 ${size.toFixed(1)}px -apple-system, "SF Pro Rounded", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('z', p.x, p.y);
    } else if (p.kind === 'puff') {
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 1.3, p.r * 0.8, p.vx * 0.05, 0, Math.PI * 2); ctx.fill();
    } else drawStar(p.x, p.y, p.r, p.c);
  }

  function draw() {
    const r = canvas.width / W;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (S.alpha < 0.01) return;
    ctx.globalAlpha = S.alpha;
    const face = S.turnT < 1 ? S.turnFrom * (1 - 2 * easeInOut(S.turnT)) : S.dir;
    const cx = W / 2;
    const footY = H - 2 - S.air;
    drawBird(cx, footY, Math.abs(face) < 0.04 ? 0.04 * Math.sign(face || 1) : face, r);

    for (const p of S.fx) drawFx(p);
    ctx.globalAlpha = S.alpha;

    if (S.count > 1 && S.badge) { // unread letters: badge pinned to the bag's corner
      const [bx, by] = S.badge;
      ctx.fillStyle = '#ff6b62';
      ctx.beginPath(); ctx.arc(bx, by, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '700 6px -apple-system, "SF Pro Text", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(S.count > 9 ? '9+' : String(S.count), bx, by + 0.4);
    }
    ctx.globalAlpha = 1;
  }

  finch.canvas.define({
    init(c) {
      api = c.finch || finch;
      canvas = c.canvas; ctx = c.ctx2d; W = c.width; H = c.height;
      k = clamp((H - 8) / 308, 0.05, 0.12);
      const d = c.initialData || {};
      S.count = d.count || 1;
      if (d.dir) S.dir = S.turnFrom = d.dir < 0 ? -1 : 1;
      buildArt();
      api.postMessage({ type: 'ready' });
    },
    resize(w, h) { W = w; H = h; k = clamp((H - 8) / 308, 0.05, 0.12); },
    frame(dt) {
      let s = dt > 1 ? dt / 1000 : dt; // tolerate ms or seconds
      s = clamp(s || 0, 0, 0.1);
      update(s);
      draw();
    },
    onPointer(e) {
      if (S.vanish || S.alpha < 0.3) return;
      if (e.type === 'down' && !S.clicked) {
        S.clicked = true;
        api.postMessage({ type: 'click' });
        return;
      }
      if (e.type === 'move') {
        S.hoverIdle = 0;
        if (!S.hover) {
          S.hover = true;
          S.act = null;
          api.postMessage({ type: 'hover', on: true });
        }
      }
    },
    onMessage(m) {
      if (!m || typeof m !== 'object') return;
      switch (m.type) {
        case 'mode':
          if (m.dir) setDir(m.dir);
          if (m.mode === 'hop' && S.mode !== 'hop') S.hopPh = 0;
          S.mode = m.mode === 'hop' || m.mode === 'fly' ? m.mode : 'stand';
          S.act = null;
          break;
        case 'act':
          if (m.dir) setDir(m.dir);
          if (S.mode === 'stand' && !S.hover) startAct(m.name);
          break;
        case 'land': S.mode = 'stand'; S.act = null; land(1); break;
        case 'happy': S.mode = 'happy'; S.happy = 0; S.act = null; spark(10, 0.6); break;
        case 'letters': S.count = m.count || 1; S.bv += 5; spark(5, 0.4); break;
        case 'vanish': S.vanish = true; break;
        case '__set': Object.assign(S, m.state || {}); break; // used by the offline preview only
        default: break;
      }
    },
  });
})();
