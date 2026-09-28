// Runs inside every captured page before its own scripts. It adds the pixel cursor and the
// caption bar, counts stream messages and requests so the recorder knows when the page has
// caught up, and hands CSS animations to the recorder's clock.
export function installOverlay() {
  const net = { messages: 0, inflight: 0 };
  window.__showcase = { net };

  const NativeSource = window.EventSource;
  window.EventSource = class extends NativeSource {
    constructor(...args) {
      super(...args);
      const bump = () => net.messages++;
      for (const name of ['message', 'snapshot', 'session', 'removed', 'cue'])
        this.addEventListener(name, bump);
    }
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    net.inflight++;
    try {
      return await nativeFetch(...args);
    } finally {
      net.inflight--;
    }
  };

  // Each CSS animation or transition plays on page time from the frame it first shows up.
  const started = new WeakMap();
  window.__showcase.driveAnimations = () => {
    const now = performance.now();
    for (const animation of document.getAnimations()) {
      if (!started.has(animation)) started.set(animation, now);
      if (animation.playState !== 'paused') animation.pause();
      animation.currentTime = now - started.get(animation);
    }
  };

  const CURSOR = [
    'X...........',
    'XX..........',
    'XWX.........',
    'XWWX........',
    'XWWWX.......',
    'XWWWWX......',
    'XWWWWWX.....',
    'XWWWWWWX....',
    'XWWWWWWWX...',
    'XWWWWWWWWX..',
    'XWWWWWWWWWX.',
    'XWWWWWWXXXXX',
    'XWWWXWWX....',
    'XWWX.XWWX...',
    'XWX..XWWX...',
    'XX....XWWX..',
    '......XWWX..',
    '.......XX...',
  ];
  const PX = 3;
  const cursorCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = (CURSOR[0].length + 1) * PX;
    canvas.height = (CURSOR.length + 1) * PX;
    const ctx = canvas.getContext('2d');
    const paint = (dx, dy, colors) => {
      CURSOR.forEach((row, y) =>
        [...row].forEach((cell, x) => {
          if (!colors[cell]) return;
          ctx.fillStyle = colors[cell];
          ctx.fillRect((x + dx) * PX, (y + dy) * PX, PX, PX);
        }),
      );
    };
    paint(1, 1, { X: 'rgba(0,0,0,0.45)', W: 'rgba(0,0,0,0.45)' });
    paint(0, 0, { X: '#14121a', W: '#fbf6e9' });
    return canvas;
  };

  const style = document.createElement('style');
  style.textContent = `
    .sc-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
      image-rendering: pixelated; will-change: transform; }
    .sc-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 12px;
      height: 12px; margin: -6px 0 0 -6px; border: 3px solid #ffd35c;
      animation: sc-ring 360ms steps(6, end) forwards; }
    @keyframes sc-ring {
      from { width: 12px; height: 12px; margin: -6px 0 0 -6px; opacity: 1; }
      to { width: 48px; height: 48px; margin: -24px 0 0 -24px; opacity: 0; }
    }
    .sc-caption { --u: 1; position: fixed; left: var(--cx, 50%); bottom: 84px;
      z-index: 2147483600; transform: translateX(-50%); pointer-events: none;
      padding: calc(22px * var(--u)) calc(34px * var(--u)) calc(20px * var(--u));
      background: #16141cf0; color: #fbf6e9; border: calc(3px * var(--u)) solid #f2c14e;
      box-shadow: calc(6px * var(--u)) calc(6px * var(--u)) 0 #00000080;
      font: calc(24px * var(--u)) / 1.6 'Press Start 2P', monospace; text-align: center;
      white-space: pre; opacity: 0; transition: opacity 240ms linear;
      -webkit-font-smoothing: none; }
    .sc-caption.is-on { opacity: 1; }
    html.sc-hide-cursor .sc-cursor { display: none; }
  `;

  const mount = () => {
    document.head.append(style);
    const cursor = cursorCanvas();
    cursor.className = 'sc-cursor';
    const caption = document.createElement('div');
    caption.className = 'sc-caption';
    document.body.append(caption, cursor);
    window.__showcase.cursorAt = (x, y) => {
      cursor.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    window.__showcase.cursorAt(-100, -100);
    window.addEventListener(
      'mousemove',
      event => {
        window.__showcase.cursorAt(event.clientX, event.clientY);
      },
      true,
    );
    window.addEventListener('mousedown', event => {
      const ring = document.createElement('div');
      ring.className = 'sc-ring';
      ring.style.left = `${event.clientX}px`;
      ring.style.top = `${event.clientY}px`;
      document.body.append(ring);
      setTimeout(() => ring.remove(), 400);
    });
    /** Keeps the caption at the bottom middle of whatever region the camera shows. */
    window.__showcase.captionFrame = ({ x, y, width, height }, unit, top) => {
      caption.style.setProperty('--u', String(unit));
      caption.style.setProperty('--cx', `${x + width / 2}px`);
      caption.style.top = top ? `${y + 40 * unit}px` : 'auto';
      caption.style.bottom = top ? 'auto' : `${innerHeight - (y + height) + 84 * unit}px`;
    };
    window.__showcase.caption = text => {
      caption.classList.remove('is-on');
      setTimeout(
        () => {
          caption.replaceChildren();
          if (!text) return;
          caption.append(text);
          caption.classList.add('is-on');
        },
        caption.textContent ? 240 : 0,
      );
    };
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
}
