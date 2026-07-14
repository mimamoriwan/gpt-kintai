import { ClipboardCheck } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark"><ClipboardCheck size={compact ? 22 : 27} /></span>
      <span className="brand-copy">
        <strong>GyoumuLog</strong>
        {!compact && <small>勤怠・業務記録</small>}
      </span>
    </div>
  );
}
