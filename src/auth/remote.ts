import type { Cdp } from './cdp';
import type { GrabRemote, GrabRemoteKey } from './types';

/** `GrabRemote.key` key → CDP key code. */
const KEYS: Record<GrabRemoteKey, { code: string; keyCode: number }> = {
  Enter: { code: 'Enter', keyCode: 13 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
};

/** Control the tab over CDP: capture frames, dispatch real mouse input (the challenge lives in a cross-origin iframe — JS `click()` can't reach it). */
export function remoteOf(tab: Cdp): GrabRemote {
  const viewport = async () => {
    const m = await tab.send<{ cssVisualViewport: { clientWidth: number; clientHeight: number } }>(
      'Page.getLayoutMetrics',
    );
    return { width: Math.round(m.cssVisualViewport.clientWidth), height: Math.round(m.cssVisualViewport.clientHeight) };
  };
  return {
    screenshot: async () => {
      const [{ data }, size] = await Promise.all([
        tab.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 60 }),
        viewport(),
      ]);
      return { image: data, ...size };
    },
    click: async (x, y) => {
      const { width, height } = await viewport();
      const px = Math.max(0, Math.min(1, x)) * width;
      const py = Math.max(0, Math.min(1, y)) * height;
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py });
      await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
      await tab.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: px,
        y: py,
        button: 'left',
        clickCount: 1,
      });
    },
    type: async (text) => {
      await tab.send('Input.insertText', { text });
    },
    drag: async (points) => {
      if (points.length < 2) return;
      const { width, height } = await viewport();
      const at = (p: { x: number; y: number }) => ({
        x: Math.max(0, Math.min(1, p.x)) * width,
        y: Math.max(0, Math.min(1, p.y)) * height,
      });
      const first = at(points[0]);
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...first });
      await tab.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...first,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });
      // Replay the human's EXACT timing (gaps between points), clamping each gap to ≤ 200 ms.
      for (let i = 1; i < points.length; i++) {
        const gap = Math.max(0, Math.min(200, points[i].t - points[i - 1].t));
        if (gap > 0) await new Promise((r) => setTimeout(r, gap));
        await tab.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          ...at(points[i]),
          button: 'left',
          buttons: 1,
        });
      }
      const last = at(points[points.length - 1]);
      await tab.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...last,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      });
    },
    key: async (key) => {
      const k = KEYS[key];
      const base = { key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
      await tab.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      if (key === 'Enter') await tab.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' });
      await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
  };
}
