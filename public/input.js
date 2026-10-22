// Keyboard (arrows + WASD), touch buttons and gamepad, merged into one state.

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

export function createInput({ onRespawn, onPause, onMute, onStats, isTyping }) {
  const keys = { up: false, down: false, left: false, right: false };
  const touch = { up: false, down: false, left: false, right: false };
  const pad = { up: false, down: false, left: false, right: false };
  let padY = false;

  function releaseAll() {
    for (const s of [keys, touch, pad]) for (const k in s) s[k] = false;
    document.querySelectorAll('#touch button.held').forEach((b) => b.classList.remove('held'));
  }

  window.addEventListener('keydown', (e) => {
    if (isTyping()) return;
    const k = KEYMAP[e.code];
    if (k) { keys[k] = true; e.preventDefault(); return; }
    if (e.repeat) return;
    if (e.code === 'KeyR') onRespawn();
    else if (e.code === 'Escape') onPause();
    else if (e.code === 'KeyM') onMute();
    else if (e.code === 'F3') { e.preventDefault(); onStats(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k) keys[k] = false;
  });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  // Touch: one pointer per button, so multi-touch (gas + steer) works.
  for (const btn of document.querySelectorAll('#touch button')) {
    const k = btn.dataset.key;
    const down = (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      touch[k] = true;
      btn.classList.add('held');
    };
    const up = (e) => {
      e.preventDefault();
      touch[k] = false;
      btn.classList.remove('held');
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');

  function pollGamepad() {
    pad.up = pad.down = pad.left = pad.right = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const b = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.2);
      const x = gp.axes[0] || 0;
      pad.left ||= x < -0.35 || b(14);
      pad.right ||= x > 0.35 || b(15);
      pad.up ||= b(7) || b(0);
      pad.down ||= b(6) || b(1);
      const y = b(3);
      if (y && !padY) onRespawn();
      padY = y;
      break;
    }
  }

  return {
    releaseAll,
    poll() {
      pollGamepad();
      return {
        up: keys.up || touch.up || pad.up,
        down: keys.down || touch.down || pad.down,
        left: keys.left || touch.left || pad.left,
        right: keys.right || touch.right || pad.right,
      };
    },
  };
}

export function inputBits(i) {
  return (i.up ? 1 : 0) | (i.down ? 2 : 0) | (i.left ? 4 : 0) | (i.right ? 8 : 0);
}
