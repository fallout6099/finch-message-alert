"""Generate Sound Cue's bundled fun sounds. Pure stdlib, all original synthesis (no samples).

Run: python3 scripts/gen_sounds.py   → writes sounds/*.wav
"""
import math
import os
import random
import struct
import wave

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds')


def note(n):
    """Semitones from A4 → Hz."""
    return 440.0 * 2 ** (n / 12)


# Note helpers (semitones relative to A4)
C5, D5, E5, F5, G5, A5, B5 = 3, 5, 7, 8, 10, 12, 14
C6, D6, E6, G6, C7 = 15, 17, 19, 22, 27


def buf(sec):
    return [0.0] * int(SR * sec)


def env(i, n, a, r):
    """Attack/exponential decay envelope; a and r in samples."""
    if i < a:
        return i / max(1, a)
    return math.exp(-(i - a) / max(1, r))


def add_tone(b, t0, dur, freq, amp=0.3, wave_='sine', attack=0.004, decay=0.25,
             harm=(1.0,), vib=0.0, sweep=1.0):
    s0 = int(t0 * SR)
    n = int(dur * SR)
    a, r = int(attack * SR), int(decay * SR)
    ph = 0.0
    for i in range(n):
        k = s0 + i
        if k >= len(b):
            break
        f = freq * (sweep ** (i / n)) * (1 + vib * math.sin(2 * math.pi * 6 * i / SR))
        ph += 2 * math.pi * f / SR
        if wave_ == 'square':
            v = 1.0 if math.sin(ph) >= 0 else -1.0
            v *= 0.5
        elif wave_ == 'triangle':
            v = 2 / math.pi * math.asin(math.sin(ph))
        else:
            v = sum(h_amp * math.sin(ph * (h + 1)) for h, h_amp in enumerate(harm))
        # short release at the end to avoid clicks
        tail = min(1.0, (n - i) / (0.005 * SR))
        b[k] += amp * v * env(i, n, a, r) * tail


def bell(b, t0, freq, amp=0.25, decay=0.6):
    # inharmonic partials → bell / glockenspiel
    for ratio, g in ((1, 1.0), (2.76, 0.45), (5.4, 0.25), (8.93, 0.12)):
        add_tone(b, t0, decay * 2.5, freq * ratio, amp * g, decay=decay / ratio ** 0.5)


def kalimba(b, t0, freq, amp=0.3):
    add_tone(b, t0, 1.2, freq, amp, harm=(1.0, 0.0, 0.25, 0.0, 0.08), attack=0.002, decay=0.35)
    add_tone(b, t0, 0.05, freq * 6.1, amp * 0.15, decay=0.01)  # pluck click


def noise_burst(b, t0, dur, amp=0.2, decay=0.05, lp=0.2, seed=1):
    rnd = random.Random(seed)
    s0, n = int(t0 * SR), int(dur * SR)
    y = 0.0
    for i in range(n):
        k = s0 + i
        if k >= len(b):
            break
        y += lp * (rnd.uniform(-1, 1) - y)
        b[k] += amp * y * math.exp(-i / (decay * SR))


def write(name, b):
    peak = max(1e-9, max(abs(x) for x in b))
    g = 0.89 / peak
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * g)) * 32767)) for x in b))
    print(f'{name}.wav  {len(b) / SR:.2f}s')


# ── 1. 料理出锅：咕嘟两声 + 欢快上行琶音 + 闪光和弦 ──
def cooking_done():
    b = buf(2.2)
    add_tone(b, 0.00, 0.12, 300, 0.35, sweep=1.8, decay=0.05)   # bloop
    add_tone(b, 0.12, 0.12, 380, 0.35, sweep=1.9, decay=0.05)   # bloop
    for i, n_ in enumerate((G5, C6, E6, G6)):
        kalimba(b, 0.30 + i * 0.09, note(n_), 0.32)
    for n_ in (C6, E6, G6, C7):
        bell(b, 0.70, note(n_), 0.12, decay=0.7)
    for j in range(8):
        bell(b, 0.75 + j * 0.06, note(C7 + random.Random(j).choice((0, 4, 7, 12))), 0.05, decay=0.15)
    write('cooking-done', b)


# ── 2. 宝箱开启：颤音铺垫 → 明亮大和弦 ──
def treasure():
    b = buf(2.0)
    for i in range(10):
        add_tone(b, i * 0.05, 0.06, note(C5 + i), 0.18, 'triangle', decay=0.04)
    for n_ in (C5, G5, C6, E6):
        add_tone(b, 0.55, 1.4, note(n_), 0.15, harm=(1, 0.3, 0.1), attack=0.01, decay=0.6, vib=0.004)
    bell(b, 0.55, note(G6), 0.1, decay=0.8)
    write('treasure', b)


# ── 3. 升级：快速音阶冲上去 ──
def level_up():
    b = buf(1.4)
    seq = (C5, D5, E5, G5, A5, C6, D6, E6)
    for i, n_ in enumerate(seq):
        add_tone(b, i * 0.045, 0.1, note(n_), 0.2, 'square', decay=0.06)
    for n_ in (C6, E6, G6):
        add_tone(b, 0.40, 0.8, note(n_), 0.12, 'square', decay=0.3)
    write('level-up', b)


# ── 4. 拾取金币（原创音程，两声叮） ──
def coin():
    b = buf(0.6)
    add_tone(b, 0.0, 0.06, note(A5), 0.25, 'square', decay=0.05)
    add_tone(b, 0.06, 0.45, note(D6 + 2), 0.25, 'square', decay=0.15)
    write('coin', b)


# ── 5. 魔法闪烁：一串随机高音铃 ──
def sparkle():
    b = buf(1.3)
    rnd = random.Random(7)
    for i in range(14):
        bell(b, i * 0.045, note(C6 + rnd.choice((0, 2, 4, 7, 9, 12, 14, 16))), 0.08, decay=0.2)
    write('magic-sparkle', b)


# ── 6. 小雀啾啾（Finch 本雀） ──
def finch_chirp():
    b = buf(0.9)
    for t0, f, sw in ((0.0, 3200, 1.6), (0.13, 3400, 1.5), (0.36, 2800, 0.6)):
        add_tone(b, t0, 0.09, f, 0.3, sweep=sw, attack=0.005, decay=0.05, vib=0.03)
    write('finch-chirp', b)


# ── 7. 叮！柜台服务铃（适合“等你确认”） ──
def service_bell():
    b = buf(1.6)
    noise_burst(b, 0.0, 0.02, 0.4, decay=0.003, lp=0.8)
    bell(b, 0.0, note(E6 + 1), 0.35, decay=0.8)
    write('service-bell', b)


# ── 8. 敲门两下（适合“等你确认”） ──
def knock():
    b = buf(0.7)
    for t0 in (0.0, 0.18):
        add_tone(b, t0, 0.12, 140, 0.5, sweep=0.7, decay=0.03)
        noise_burst(b, t0, 0.06, 0.3, decay=0.01, lp=0.15, seed=int(t0 * 100))
    write('knock-knock', b)


# ── 9. 失败：复古下滑“哇哇哇” ──
def wah_wah():
    b = buf(1.6)
    for i, n_ in enumerate((G5 - 12, F5 - 12 - 1, E5 - 12 - 2)):
        add_tone(b, i * 0.32, 0.3, note(n_), 0.22, 'square', attack=0.02, decay=0.4, vib=0.02)
    add_tone(b, 0.96, 0.6, note(D5 - 15), 0.22, 'square', attack=0.02, decay=0.5, vib=0.03, sweep=0.92)
    write('wah-wah', b)


# ── 10. 水泡“啵” ──
def bubble():
    b = buf(0.3)
    add_tone(b, 0.0, 0.12, 500, 0.5, sweep=2.6, attack=0.002, decay=0.04)
    write('bubble-pop', b)


# ── 11. 打字机换行“叮” ──
def typewriter():
    b = buf(1.0)
    noise_burst(b, 0.0, 0.05, 0.35, decay=0.01, lp=0.5, seed=3)
    bell(b, 0.08, note(A5 + 12), 0.25, decay=0.35)
    write('typewriter-ding', b)


# ── 12. 寺院钟声（长任务完成，沉稳） ──
def temple_bell():
    b = buf(3.5)
    bell(b, 0.0, note(C5 - 24), 0.5, decay=1.6)
    write('temple-bell', b)


# ── 13. 拇指琴三连（柔和完成） ──
def kalimba_trio():
    b = buf(1.6)
    for i, n_ in enumerate((E5, G5, C6)):
        kalimba(b, i * 0.14, note(n_), 0.3)
    write('kalimba', b)


# ── 14. 8-bit 能量充满 ──
def powerup():
    b = buf(0.9)
    for i in range(3):
        add_tone(b, i * 0.15, 0.15, note(C5 + i * 5), 0.22, 'square', sweep=2.0, decay=0.2)
    write('power-up', b)


if __name__ == '__main__':
    for fn in (cooking_done, treasure, level_up, coin, sparkle, finch_chirp, service_bell, knock,
               wah_wah, bubble, typewriter, temple_bell, kalimba_trio, powerup):
        fn()
