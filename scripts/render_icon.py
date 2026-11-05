"""Render icon.png (256x256) from assets/bird-canvas.js with headless Chrome (dev only).

Usage: python3 -I scripts/render_icon.py   → icon.png at the package root
The bird is drawn by the same canvas script the app uses, on a night menu-bar tile with a notch.
"""
import json
import os
import subprocess
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
SIZE = 256

HTML = r'''<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style>
<canvas id="c" width="__S__" height="__S__"></canvas><script>
const SRC = __SRC__, S = __S__;
const out = document.getElementById('c'), g = out.getContext('2d');
// tile: rounded square, night-blue gradient, menu-bar strip with a camera notch
const r = S * 0.22;
g.beginPath(); g.roundRect(0, 0, S, S, r); g.clip();
const bg = g.createLinearGradient(0, 0, 0, S);
bg.addColorStop(0, '#1d3b4a'); bg.addColorStop(1, '#0b1a22');
g.fillStyle = bg; g.fillRect(0, 0, S, S);
g.fillStyle = '#05080a'; g.fillRect(0, 0, S, S * 0.15);
g.beginPath(); g.roundRect(S * 0.6, -S * 0.1, S * 0.3, S * 0.27, S * 0.06); g.fill();
// soft glow under the bird
const glow = g.createRadialGradient(S * 0.46, S * 0.6, 0, S * 0.46, S * 0.6, S * 0.42);
glow.addColorStop(0, 'rgba(125,210,180,0.28)'); glow.addColorStop(1, 'rgba(125,210,180,0)');
g.fillStyle = glow; g.fillRect(0, 0, S, S);
// bird, rendered by the real canvas script
const W = 40, H = 40, dpr = S * 0.74 / W;
const c = document.createElement('canvas'); c.width = W * dpr; c.height = H * dpr;
let def; const fake = { canvas: { define(d) { def = d; }, invalidate() {} }, postMessage() {}, window: {} };
new Function('finch', SRC)(fake);
def.init({ canvas: c, ctx2d: c.getContext('2d'), width: W, height: H, dpr, finch: fake, initialData: { dir: 1 } });
def.onMessage({ type: '__set', state: { alpha: 1, actIn: 99, blinkIn: 99, fx: [] } });
for (let i = 0; i < 40; i++) def.frame(1 / 60);
def.onMessage({ type: '__set', state: { hover: true, hoverIdle: -99, actIn: 99, blinkIn: 99 } });
for (let i = 0; i < 40; i++) def.frame(1 / 60);
g.drawImage(c, S * 0.17, S * 0.15, W * dpr, H * dpr);
document.title = 'done';
</script>'''


def main():
    src = open(os.path.join(ROOT, 'assets', 'bird-canvas.js'), encoding='utf-8').read()
    html = HTML.replace('__SRC__', json.dumps(src)).replace('__S__', str(SIZE))
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, 'icon.html')
        open(page, 'w', encoding='utf-8').write(html)
        png = os.path.join(ROOT, 'icon.png')
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                        '--default-background-color=00000000', f'--window-size={SIZE},{SIZE}',
                        '--virtual-time-budget=2000', f'--screenshot={png}', 'file://' + page],
                       check=True, capture_output=True, timeout=60)
    print(png)


if __name__ == '__main__':
    main()
