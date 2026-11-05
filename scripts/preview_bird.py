"""Render an offline pose sheet of assets/bird-canvas.js with headless Chrome (dev only).

Usage: python3 -I scripts/preview_bird.py <out_dir>   → <out_dir>/bird-sheet.png
"""
import json
import os
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

STAND_L = [{'type': 'mode', 'mode': 'stand', 'dir': -1}]
# (label, messages, state overrides). __act/__at: start a daily action and render it __at seconds in;
# __at alone: keep animating that long after the overrides (lets smoothed values settle).
POSES = [
    ('站立 · 朝左', STAND_L, {}),
    ('站立 · 朝右', [{'type': 'mode', 'mode': 'stand', 'dir': 1}], {}),
    ('蹦跳 · 腾空', [{'type': 'mode', 'mode': 'hop', 'dir': -1}], {'hopPh': 0.5}),
    ('飞行 · 邮包后飘', [{'type': 'mode', 'mode': 'fly', 'dir': -1}], {'flapPh': 1.5708}),
    ('挥翅打招呼', STAND_L, {'__act': 'wave', '__at': 0.5}),
    ('伸懒腰', STAND_L, {'__act': 'stretch', '__at': 0.75}),
    ('打哈欠', STAND_L, {'__act': 'yawn', '__at': 0.75}),
    ('哼歌', STAND_L, {'__act': 'sing', '__at': 1.3}),
    ('抖羽毛', STAND_L, {'__act': 'fluff', '__at': 0.5}),
    ('掏信晃一晃', STAND_L, {'__act': 'mail', '__at': 0.8}),
    ('打个盹', STAND_L, {'__act': 'doze', '__at': 2.1}),
    ('摇摆跳舞', STAND_L, {'__act': 'dance', '__at': 0.31}),
    ('鼠标悬停 · 亮出信', STAND_L, {'hover': True, 'hoverIdle': -99, '__at': 0.6}),
    ('3 封信角标', STAND_L, {'count': 3}),
    ('浅色菜单栏', STAND_L, {'__light': True}),
    ('飞行 · 翅膀下压', [{'type': 'mode', 'mode': 'fly', 'dir': -1}], {'flapPh': 4.712}),
]

HTML = r'''<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#2a2d31;font:13px -apple-system,sans-serif;color:#ccc}
.grid{display:grid;grid-template-columns:repeat(4,300px);gap:10px}
.tile{background:#0d0d0f;border-radius:8px;padding:6px}.tile.light{background:#d8d8dc}
.tile canvas{width:300px;height:165px;display:block}
h3{margin:16px 0 6px;font-size:13px;color:#eee}</style>
<div class="grid" id="g"></div><h3>实际大小（Retina 2x 像素，菜单栏 33pt）</h3><canvas id="bar"></canvas>
<script>
const SRC = __SRC__; const POSES = __POSES__;
function make(W, H, dpr, init) {
  const c = document.createElement('canvas'); c.width = W * dpr; c.height = H * dpr;
  let def; const fake = { canvas: { define(d) { def = d; }, invalidate() {} }, postMessage() {}, window: {} };
  new Function('finch', SRC)(fake);
  def.init({ canvas: c, ctx2d: c.getContext('2d'), width: W, height: H, dpr, finch: fake, initialData: init || {} });
  return { c, def };
}
function pose(def, msgs, st) {
  msgs.forEach((m) => def.onMessage(m));
  def.onMessage({ type: '__set', state: { alpha: 1, actIn: 99, blinkIn: 99, fx: [] } });
  for (let i = 0; i < 40; i++) def.frame(1 / 60);
  const s = Object.assign({}, st); delete s.__light; delete s.__act; delete s.__at;
  def.onMessage({ type: '__set', state: Object.assign({ actIn: 99, blinkIn: 99, fx: [] }, s) });
  if (st.__act) def.onMessage({ type: 'act', name: st.__act });
  const n = Math.round((st.__at || 0) * 60);
  for (let i = 0; i < n; i++) def.frame(1 / 60);
  def.frame(0.0001);
}
const g = document.getElementById('g');
for (const [label, msgs, st] of POSES) {
  const { c, def } = make(60, 33, 10, {});
  pose(def, msgs, st);
  const t = document.createElement('div'); t.className = 'tile' + (st.__light ? ' light' : '');
  const l = document.createElement('div'); l.textContent = label; l.style.color = st.__light ? '#333' : '#aaa';
  t.appendChild(l); t.appendChild(c); g.appendChild(t);
}
// real-size strip: 640pt wide menu bar section with the notch on the right
const BW = 640, BH = 33, D = 2, bar = document.getElementById('bar');
bar.width = BW * D; bar.height = BH * D; bar.style.width = BW * D + 'px';
const b = bar.getContext('2d'); b.scale(D, D);
b.fillStyle = '#050506'; b.fillRect(0, 0, BW, BH);
b.fillStyle = '#f2f2f2'; b.font = '600 13px -apple-system'; b.fillText('Finch', 14, 21);
b.font = '13px -apple-system'; ['File', 'Edit', 'View', 'Window'].forEach((w, i) => b.fillText(w, 64 + i * 46, 21));
b.fillStyle = '#000'; b.beginPath(); b.roundRect(480, -10, 185, 42, 10); b.fill();
b.strokeStyle = '#333'; b.setLineDash([3, 3]); b.stroke(); b.setLineDash([]);
[[290, 'hop', {}], [350, 'stand', { __act: 'sing', __at: 1.3 }], [410, 'stand', { __act: 'mail', __at: 0.8 }]].forEach(([x, mode, st]) => {
  const { c, def } = make(60, 33, D, {});
  pose(def, [{ type: 'mode', mode, dir: -1 }], Object.assign({ hopPh: 0.4 }, st));
  b.drawImage(c, x, 0, 60, 33);
});
</script>'''


def main():
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    os.makedirs(out, exist_ok=True)
    src = open(os.path.join(ROOT, 'assets', 'bird-canvas.js'), encoding='utf-8').read()
    html = HTML.replace('__SRC__', json.dumps(src)).replace('__POSES__', json.dumps(POSES, ensure_ascii=False))
    page = os.path.join(out, 'bird-preview.html')
    with open(page, 'w', encoding='utf-8') as f:
        f.write(html)
    png = os.path.join(out, 'bird-sheet.png')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    '--window-size=1290,1060', '--virtual-time-budget=2000', f'--screenshot={png}', 'file://' + page],
                   check=True, capture_output=True, timeout=60)
    print(png)


if __name__ == '__main__':
    main()
