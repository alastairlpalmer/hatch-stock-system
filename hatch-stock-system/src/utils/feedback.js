/**
 * Audio + haptic feedback for the barcode scanner.
 *
 * iOS quirks:
 *   - AudioContext must be created (and `resume()`-d) inside a user gesture
 *     handler, otherwise it stays suspended and beep() is a no-op.
 *   - navigator.vibrate is not implemented in iOS Safari. We invoke it
 *     anyway (no-op) and document this honestly so callers don't expect
 *     haptics on iPhones.
 */

let ctx = null;

/**
 * Lazily create or resume a shared AudioContext. Must be called from
 * a user-gesture-driven callback (e.g. an onClick handler). If invoked
 * before any gesture, the context will be created in the suspended
 * state on iOS and produce no sound until `resume()` is called.
 *
 * Call this once when the scanner overlay opens, from the same click
 * that opens it.
 */
export function unlockAudio() {
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      ctx = null;
      return;
    }
  }
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    ctx.resume().catch(() => {});
  }
}

/**
 * Short tone via Web Audio API.
 * @param {number} freq - Frequency in Hz (default 880 = A5).
 * @param {number} ms   - Duration in ms.
 * @param {number} vol  - 0..1 gain.
 */
export function beep(freq = 880, ms = 80, vol = 0.15) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain).connect(ctx.destination);
    const now = ctx.currentTime;
    // Tiny attack/release so it doesn't click.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + ms / 1000);
    osc.start(now);
    osc.stop(now + ms / 1000 + 0.02);
  } catch {
    /* swallow — feedback is best-effort */
  }
}

/**
 * Buzzer-style two-tone for "off-list" / "unknown" results.
 */
export function beepError() {
  beep(440, 90);
  setTimeout(() => beep(330, 120), 100);
}

/**
 * Vibrate the device. No-op on iOS Safari and on browsers that don't
 * implement the Vibration API. Don't promise haptics on iPhone.
 * @param {number | number[]} pattern - ms or pattern array.
 */
export function haptic(pattern = 50) {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* swallow */
  }
}
