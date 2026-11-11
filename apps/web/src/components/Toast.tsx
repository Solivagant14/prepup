/**
 * A short message that appears near the bottom of the screen after an action
 * and leaves by itself. It can carry one follow-up, such as Undo.
 */
import { useEffect } from "react";

export interface ToastMessage {
  /** A new id restarts the timer, even when the words repeat. */
  id: number;
  text: string;
  error?: boolean;
  action?: { label: string; run: () => void };
}

const SHORT_MS = 4000;
/** Long enough to read the message and reach the button. */
const LONG_MS = 8000;

export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDone, toast.action || toast.error ? LONG_MS : SHORT_MS);
    return () => clearTimeout(timer);
  }, [toast, onDone]);

  // The region is always on the page, so screen readers announce what appears in it.
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className={`toast${toast.error ? " error" : ""}`}>
          <span className="toast-text">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action!.run();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDone}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </div>
  );
}
