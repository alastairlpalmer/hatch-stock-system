import React, { useCallback, useEffect, useState } from 'react';
import { X, Flashlight, Keyboard } from 'lucide-react';
import useBarcodeScanner from '../../hooks/useBarcodeScanner';
import { unlockAudio, beep, beepError, haptic } from '../../utils/feedback';
import ScanResultToast from './ScanResultToast';

/**
 * Fullscreen camera overlay that decodes barcodes and emits each accepted
 * scan via `onScan(code)`. The host page is responsible for looking up
 * the product and deciding what to do with the result; the host can then
 * call `flash({ kind, message, detail })` (received via `onReady`) to
 * surface the green/yellow/red confirmation flash inside the overlay
 * without closing it.
 *
 * Camera stays on between scans so the warehouse user can scan many
 * items in succession.
 *
 * iOS notes:
 *  - The video element below has `playsInline`, `autoPlay`, `muted`. Do
 *    not change these — without `playsInline`, iOS Safari hijacks to its
 *    system video player.
 *  - The opening tap (the parent's "Scan" button) is the user gesture
 *    that unlocks audio. We unlock here in an onClick fallback too.
 *
 * Props:
 *  - open:      bool, controls mount/unmount of the overlay
 *  - title:     string, header label
 *  - onScan:    (code: string) => void  — called for each accepted scan
 *  - onClose:   () => void
 *  - onReady:   (api: { flash }) => void — optional ref into the toast API
 */
export default function BarcodeScanner({ open, title = 'Scan barcode', onScan, onClose, onReady }) {
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [toast, setToast] = useState({ open: false, kind: 'success', message: '', detail: '' });
  const [scanCount, setScanCount] = useState(0);

  const handleAccepted = useCallback(
    (code) => {
      setScanCount((n) => n + 1);
      onScan?.(code);
    },
    [onScan]
  );

  const {
    videoRef,
    isScanning,
    error,
    start,
    stop,
    torchSupported,
    torchOn,
    toggleTorch,
  } = useBarcodeScanner({ onScan: handleAccepted });

  // Expose a flash() handle so the parent can paint a result toast.
  useEffect(() => {
    if (!onReady) return;
    onReady({
      flash: (next) => {
        setToast({ open: true, ...next });
        // Audio cue tracks the kind so warehouse staff can hear-check
        // without looking back at the screen.
        if (next.kind === 'success') {
          beep(880, 80);
          haptic(40);
        } else if (next.kind === 'warn') {
          beep(660, 100);
          haptic([30, 40, 30]);
        } else {
          beepError();
          haptic([60, 60, 60]);
        }
      },
    });
  }, [onReady]);

  // Start the camera when the overlay opens. start() is invoked from
  // the user gesture that toggled `open`, so iOS allows it.
  useEffect(() => {
    if (open) {
      unlockAudio();
      start();
    } else {
      stop();
    }
    return () => stop();
    // start/stop are stable refs from the hook; we only want this on `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Pause the camera when the OS hides the page (tab switched, screen off)
  // and resume on return. Avoids the camera staying held in the background.
  // We also re-unlock the audio context on resume — iOS suspends it when
  // the page is backgrounded, so beep() would otherwise be silent until
  // the next user gesture.
  useEffect(() => {
    if (!open) return undefined;
    const onVis = () => {
      if (document.hidden) {
        stop();
      } else {
        unlockAudio();
        start();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submitManual = (e) => {
    e?.preventDefault?.();
    const code = manualValue.trim();
    if (!code) return;
    setManualValue('');
    setShowManual(false);
    handleAccepted(code);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/80 backdrop-blur border-b border-zinc-800 text-zinc-100">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              stop();
              onClose?.();
            }}
            className="p-2 -ml-2 rounded hover:bg-zinc-800"
            aria-label="Close scanner"
          >
            <X size={20} />
          </button>
          <div>
            <div className="text-sm font-medium">{title}</div>
            <div className="text-xs text-zinc-500">
              {scanCount > 0 ? `${scanCount} scanned` : 'Point camera at barcode'}
            </div>
          </div>
        </div>
        {torchSupported && (
          <button
            onClick={toggleTorch}
            className={`p-2 rounded ${torchOn ? 'bg-amber-500/30 text-amber-200' : 'hover:bg-zinc-800 text-zinc-300'}`}
            aria-label="Toggle torch"
          >
            <Flashlight size={20} />
          </button>
        )}
      </div>

      {/* Camera surface */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover bg-black"
          playsInline
          autoPlay
          muted
        />

        {/* Viewfinder */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="relative w-[80%] max-w-md aspect-[4/3]">
            <div className="absolute inset-0 border-2 border-emerald-400/70 rounded-xl" />
            {/* Corner accents for visual polish */}
            <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
            <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
            <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />
          </div>
        </div>

        {/* Permission / error states */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6">
            <div className="bg-zinc-900 border border-red-500/40 rounded-lg p-5 max-w-sm text-center text-sm text-zinc-200">
              <div className="text-red-400 font-medium mb-2">Camera unavailable</div>
              <p className="text-zinc-400 mb-3">
                {error.name === 'NotAllowedError'
                  ? "Camera permission was denied. On iPhone: Settings → Safari → Camera → Allow. Then reload."
                  : error.message || 'Could not start the camera. Try again.'}
              </p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={start}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm"
                >
                  Retry
                </button>
                <button
                  onClick={() => {
                    stop();
                    onClose?.();
                  }}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {!isScanning && !error && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-zinc-300 text-xs bg-black/50 px-3 py-1.5 rounded-full">
            Starting camera…
          </div>
        )}

        <ScanResultToast
          open={toast.open}
          kind={toast.kind}
          message={toast.message}
          detail={toast.detail}
          onDone={() => setToast((t) => ({ ...t, open: false }))}
        />

        {/* Manual entry sheet */}
        {showManual && (
          <form
            onSubmit={submitManual}
            className="absolute bottom-20 left-4 right-4 bg-zinc-900/95 border border-zinc-700 rounded-lg p-3 backdrop-blur"
          >
            <label className="text-xs text-zinc-400 mb-1 block">Enter SKU or barcode</label>
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                inputMode="text"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm text-white"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowManual(false);
                  setManualValue('');
                }}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm text-zinc-200"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/80 backdrop-blur border-t border-zinc-800 text-zinc-100">
        <button
          onClick={() => setShowManual((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
        >
          <Keyboard size={16} />
          Manual entry
        </button>
        <button
          onClick={() => {
            stop();
            onClose?.();
          }}
          className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
        >
          Done
        </button>
      </div>
    </div>
  );
}
