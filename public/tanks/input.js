// Mouse/touch drag aiming, keyboard and gamepad.
// handlers: { drag(clientX, clientY, phase), key(action, fine), stick(dAngle, dPower) }

const KEYMAP = {
  ArrowLeft: 'angleUp', ArrowRight: 'angleDown', ArrowUp: 'powerUp', ArrowDown: 'powerDown',
  Space: 'fire', Enter: 'fire', NumpadEnter: 'fire', KeyA: 'moveLeft', KeyD: 'moveRight',
  KeyQ: 'prevWeapon', KeyE: 'nextWeapon', KeyM: 'mute', Escape: 'menu',
};

export function createInput(canvas, handlers) {
  let dragging = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);
    handlers.drag(e.clientX, e.clientY, 'start');
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging !== e.pointerId) return;
    handlers.drag(e.clientX, e.clientY, 'move');
    e.preventDefault();
  });
  const end = (e) => {
    if (dragging !== e.pointerId) return;
    dragging = null;
    handlers.drag(e.clientX, e.clientY, 'end');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' && t.type !== 'range' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const action = KEYMAP[e.code];
    if (!action) return;
    if (handlers.key(action, e.shiftKey, e.repeat) !== false) e.preventDefault();
  });

  // gamepad: left stick X = angle, right stick Y / triggers = power, A fire, LB/RB weapon, d-pad move
  const prev = {};
  function pollGamepad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find(Boolean);
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    const lx = dz(gp.axes[0] || 0), ry = dz(gp.axes[3] || 0);
    const lt = gp.buttons[6]?.value || 0, rt = gp.buttons[7]?.value || 0;
    const dA = -lx * 60 * dt, dP = (-ry + rt - lt) * 40 * dt;
    if (dA || dP) handlers.stick(dA, dP);
    const press = (i, action) => {
      const down = !!gp.buttons[i]?.pressed;
      if (down && !prev[i]) handlers.key(action, false, false);
      prev[i] = down;
    };
    press(0, 'fire'); press(4, 'prevWeapon'); press(5, 'nextWeapon'); press(14, 'moveLeft'); press(15, 'moveRight'); press(9, 'menu');
  }

  return { pollGamepad, isDragging: () => dragging != null };
}
