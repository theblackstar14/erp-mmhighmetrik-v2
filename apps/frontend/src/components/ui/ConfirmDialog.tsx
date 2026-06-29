import { AlertTriangle, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils.js';

// Diálogo de confirmación acorde al diseño del ERP (reemplaza window.confirm).
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="w-full max-w-sm rounded-xl border border-line bg-bg-elev p-5 shadow-2xl animate-modalPop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tone === 'danger' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}>
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold leading-tight">{title}</h3>
            {message && <p className="mt-1.5 text-[12.5px] text-ink-3 leading-snug">{message}</p>}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} disabled={loading} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken disabled:opacity-50">{cancelLabel}</button>
          <button onClick={onConfirm} disabled={loading} className={cn('inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50', tone === 'danger' ? 'bg-destructive' : 'bg-primary')}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
