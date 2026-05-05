import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useBarcodeScanner
 *
 * Encapsulates camera lifecycle and barcode decoding for the scanner
 * overlay. Tries the native BarcodeDetector API first (iOS 17+, Chrome,
 * Edge, Samsung Internet — zero JS bundle cost). Falls back to a lazy
 * dynamic import of @zxing/browser for older Safari and Firefox.
 *
 * Public surface:
 *   const {
 *     videoRef, isScanning, error,
 *     start, stop,
 *     torchSupported, torchOn, toggleTorch,
 *   } = useBarcodeScanner({ onScan, debounceMs });
 *
 * Notes / iOS gotchas:
 *   - `start()` MUST be called from a user-gesture handler (e.g. onClick).
 *     Calling it from useEffect on mount will be blocked by iOS Safari.
 *   - The <video> element bound to videoRef MUST have `playsInline`,
 *     `autoPlay`, and `muted` set, otherwise iOS hijacks to its system
 *     video player.
 *   - On unmount we always release MediaStreamTracks; leaking the camera
 *     causes the green/orange recording indicator to stick.
 *
 * @param {Object} opts
 * @param {(code: string) => void} opts.onScan - called once per accepted scan
 * @param {number} [opts.debounceMs=1500] - ignore identical codes within this window
 * @param {string[]} [opts.formats] - barcode symbologies to recognize
 */
export default function useBarcodeScanner({
  onScan,
  debounceMs = 1500,
  formats = [
    'ean_13',
    'ean_8',
    'upc_a',
    'upc_e',
    'code_128',
    'code_39',
    'qr_code',
    'data_matrix',
    'itf',
  ],
} = {}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const zxingControlsRef = useRef(null); // BrowserMultiFormatReader controls (fallback path)
  const rafRef = useRef(0);
  const lastScanRef = useRef({ code: '', at: 0 });
  // Flips to true when stop() runs. Each start() captures its own session
  // id and bails out early if stop() ran while it was awaiting an async
  // step (getUserMedia permission prompt, getSupportedFormats, etc.).
  const sessionRef = useRef(0);
  // Latest onScan reference so we don't have to restart the loop on prop change.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  /** Hand a candidate barcode through the debounce gate to onScan. */
  const handleDecoded = useCallback(
    (code) => {
      if (!code) return;
      const now = Date.now();
      if (
        code === lastScanRef.current.code &&
        now - lastScanRef.current.at < debounceMs
      ) {
        return; // duplicate burst — ignore
      }
      lastScanRef.current = { code, at: now };
      try {
        onScanRef.current?.(code);
      } catch (e) {
        // Caller threw inside their onScan — surface to console but don't
        // kill the loop.
        // eslint-disable-next-line no-console
        console.error('[useBarcodeScanner] onScan handler threw', e);
      }
    },
    [debounceMs]
  );

  /** Native-API decode loop. Cheap to call, no allocations per frame beyond the canvas-less detect(). */
  const startNativeLoop = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector) return;

    const tick = async () => {
      if (!streamRef.current) return; // stopped
      // Skip frames before the video has dimensions to avoid the
      // "InvalidStateError: source width is 0" Chrome throws.
      if (video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const codes = await detector.detect(video);
          if (codes && codes.length) {
            handleDecoded(codes[0].rawValue);
          }
        } catch {
          /* transient frame errors are fine — try again next tick */
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [handleDecoded]);

  /** ZXing fallback. Library is dynamic-imported so it stays out of the main bundle. */
  const startZxingLoop = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatReader();
    // decodeFromStream consumes the existing MediaStream so we don't
    // double-acquire the camera.
    const controls = await reader.decodeFromStream(
      streamRef.current,
      video,
      (result) => {
        if (result) handleDecoded(result.getText());
      }
    );
    zxingControlsRef.current = controls;
  }, [handleDecoded]);

  const stop = useCallback(() => {
    // Invalidate any in-flight start() awaiting getUserMedia.
    sessionRef.current += 1;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (zxingControlsRef.current) {
      try {
        zxingControlsRef.current.stop();
      } catch {
        /* ignore */
      }
      zxingControlsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        /* ignore */
      }
    }
    setIsScanning(false);
    setTorchOn(false);
  }, []);

  const start = useCallback(async () => {
    // Guard against re-entry. Without this, a visibility-change flap or
    // a stray double-click would acquire two camera tracks and leak the
    // first one (the green/orange "recording" indicator gets stuck on
    // iOS even after stop()).
    if (streamRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(new Error('Camera not supported on this device.'));
      return;
    }
    setError(null);

    // Snapshot the session so we can detect a stop() that happened while
    // we were awaiting getUserMedia (the user can dismiss the permission
    // sheet on iOS while we're suspended on `await`).
    const session = ++sessionRef.current;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (err) {
      if (session !== sessionRef.current) return;
      setError(err);
      return;
    }

    // stop() ran during the await — release the orphaned stream and bail.
    if (session !== sessionRef.current) {
      stream.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
      return;
    }

    streamRef.current = stream;

    // Detect torch capability up-front so the UI can render the toggle.
    const track = stream.getVideoTracks()[0];
    if (track && typeof track.getCapabilities === 'function') {
      try {
        const caps = track.getCapabilities();
        setTorchSupported(Boolean(caps && caps.torch));
      } catch {
        setTorchSupported(false);
      }
    }

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      try {
        await videoRef.current.play();
      } catch {
        // Some browsers throw AbortError if play() is interrupted by stop()
        // — safe to ignore here; tick() guards on readyState.
      }
    }

    // Decide decoder.
    try {
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        // eslint-disable-next-line no-undef
        let supported = formats;
        try {
          // eslint-disable-next-line no-undef
          const list = await BarcodeDetector.getSupportedFormats();
          supported = formats.filter((f) => list.includes(f));
          if (!supported.length) supported = list; // unusual; fall back to all
        } catch {
          /* not all impls expose getSupportedFormats */
        }
        // eslint-disable-next-line no-undef
        detectorRef.current = new BarcodeDetector({ formats: supported });
        await startNativeLoop();
      } else {
        await startZxingLoop();
      }
      setIsScanning(true);
    } catch (err) {
      setError(err);
      stop();
    }
  }, [formats, startNativeLoop, startZxingLoop, stop]);

  const toggleTorch = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (err) {
      // Some Android Chrome builds fail silently if torch is unavailable
      // mid-stream; surface to caller.
      setError(err);
    }
  }, [torchOn]);

  // Always release the camera on unmount, even if caller forgets to stop().
  useEffect(() => stop, [stop]);

  return {
    videoRef,
    isScanning,
    error,
    start,
    stop,
    torchSupported,
    torchOn,
    toggleTorch,
  };
}
