import assert from 'node:assert/strict';
import { classify, inQuietHours, resolveSoundPath, toAfplayVolume } from '../dist/logic.js';

// classify
assert.equal(classify({ kind: 'status', executionPhase: 'completed' }), 'completed');
assert.equal(classify({ kind: 'result' }), 'completed');
assert.equal(classify({ kind: 'interrupted' }), 'interrupted');
assert.equal(classify({ kind: 'status', executionPhase: 'interrupted' }), 'interrupted');
assert.equal(classify({ kind: 'error', isRetryable: true }), undefined);
assert.equal(classify({ kind: 'error' }), 'failed');
assert.equal(classify({ kind: 'status', executionPhase: 'waiting_user' }), 'waiting');
assert.equal(classify({ kind: 'permission_request' }), 'waiting');
assert.equal(classify({ kind: 'status', executionPhase: 'retry_wait' }), 'retry');
assert.equal(classify({ kind: 'compact_boundary', compactionPhase: 'start' }), undefined);
assert.equal(classify({ kind: 'compact_boundary', compactionPhase: 'end' }), 'compacted');
assert.equal(classify({ kind: 'tool_result', isToolError: true }), 'toolError');
assert.equal(classify({ kind: 'tool_result' }), undefined);
assert.equal(classify({ kind: 'result', internal: true }), undefined);
assert.equal(classify({ kind: 'assistant_text_delta', executionPhase: 'streaming' }), undefined);

// quiet hours
const at = (h, m) => new Date(2026, 0, 1, h, m);
assert.equal(inQuietHours('23:00-08:00', at(23, 30)), true);
assert.equal(inQuietHours('23:00-08:00', at(7, 59)), true);
assert.equal(inQuietHours('23:00-08:00', at(8, 0)), false);
assert.equal(inQuietHours('12:00-13:30', at(13, 0)), true);
assert.equal(inQuietHours('12:00 到 13:30', at(14, 0)), false);
assert.equal(inQuietHours('', at(1, 0)), false);
assert.equal(inQuietHours('garbage', at(1, 0)), false);

// sound path
assert.equal(resolveSoundPath('Glass', '', '/h'), '/System/Library/Sounds/Glass.aiff');
assert.equal(resolveSoundPath('none', '', '/h'), undefined);
assert.equal(resolveSoundPath('custom', '~/a.mp3', '/h'), '/h/a.mp3');
assert.equal(resolveSoundPath('custom', '', '/h'), undefined);

// volume
assert.equal(toAfplayVolume(60), 0.6);
assert.equal(toAfplayVolume(500), 1);
assert.equal(toAfplayVolume('x'), 0.6);

console.log('selftest ok');
assert.equal(resolveSoundPath('fun:cooking-done', '', '/h', '/x/sounds/'), '/x/sounds/cooking-done.wav');
assert.equal(resolveSoundPath('fun:../etc', '', '/h', '/x/sounds'), '/x/sounds/etc.wav');
console.log('fun sounds ok');
import { pickNotchGeometry } from '../dist/logic.js';
// this Mac: 1512 wide, notch 663.5–848.5, menu bar 33
const mbp = { x: 0, y: 0, w: 1512, h: 982, bar: 33, top: 32, ll: 663.5, rw: 663.5 };
const g = pickNotchGeometry([mbp]);
assert.equal(g.hasNotch, true); assert.equal(g.notchLeft, 663.5); assert.equal(g.notchRight, 848.5); assert.equal(g.barH, 33);
// external primary without notch + built-in notch display to its right
const ext = { x: 0, y: 0, w: 2560, h: 1440, bar: 25, top: 0, ll: 0, rw: 0 };
const g2 = pickNotchGeometry([ext, { ...mbp, x: 2560, y: 200 }]);
assert.equal(g2.hasNotch, true); assert.equal(g2.notchLeft, 2560 + 663.5); assert.equal(g2.screenY, 200);
const g3 = pickNotchGeometry([ext]);
assert.equal(g3.hasNotch, false); assert.equal(g3.notchLeft, 1280); assert.equal(g3.barH, 25);
assert.equal(pickNotchGeometry([{ ...mbp, bar: 0 }]).barH, 32); // auto-hidden menu bar → notch height
assert.equal(pickNotchGeometry([]), undefined);
console.log('notch geometry ok');
