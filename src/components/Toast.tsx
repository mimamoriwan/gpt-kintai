import { CheckCircle2, CircleAlert, X } from "lucide-react";

export interface ToastState { type: "success" | "error"; message: string }

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.type}`} role="status">
      {toast.type === "success" ? <CheckCircle2 size={20} /> : <CircleAlert size={20} />}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="閉じる"><X size={18} /></button>
    </div>
  );
}
