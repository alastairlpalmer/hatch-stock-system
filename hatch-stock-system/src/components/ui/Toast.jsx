import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

// Minimal app-wide toast system. Until now CRUD feedback was ad-hoc per page
// (inline banners, or nothing at all). Usage:
//   const toast = useToast();
//   toast.success('Expiry saved');
//   toast.error('Save failed — try again');
// Toasts stack bottom-centre, above the mobile bottom nav, and auto-dismiss.

const ToastContext = createContext(null);

const AUTO_DISMISS_MS = 3500;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idSeq = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind, message) => {
    const id = ++idSeq.current;
    setToasts((prev) => [...prev.slice(-2), { id, kind, message }]);
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }, [dismiss]);

  const api = useRef({
    success: (msg) => push('success', msg),
    error: (msg) => push('error', msg),
  });
  api.current.success = (msg) => push('success', msg);
  api.current.error = (msg) => push('error', msg);

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 md:bottom-6 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl ${
                t.kind === 'error'
                  ? 'border-red-500/40 bg-red-950 text-red-300'
                  : 'border-emerald-500/40 bg-emerald-950 text-emerald-300'
              }`}
            >
              {t.kind === 'error'
                ? <AlertTriangle size={16} className="shrink-0" />
                : <CheckCircle2 size={16} className="shrink-0" />}
              <span className="min-w-0">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="ml-1 shrink-0 p-1 opacity-60 hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  // No-op fallback so components stay usable in isolation/tests.
  return ctx || { success: () => {}, error: () => {} };
}
