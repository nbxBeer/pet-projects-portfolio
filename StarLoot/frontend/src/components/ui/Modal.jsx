import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';

export default function Modal({ open, onClose, title, backLabel, onBack, headerActions, headerLeftActions, children, className = '' }) {
  useEffect(() => {
    if (!open) return;
    const count = Number(document.body.dataset.modalOpenCount || '0');
    if (count === 0) {
      document.body.dataset.modalPrevOverflow = document.body.style.overflow;
    }

    document.body.dataset.modalOpenCount = String(count + 1);
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';

    return () => {
      const nextCount = Math.max(0, Number(document.body.dataset.modalOpenCount || '1') - 1);
      if (nextCount > 0) {
        document.body.dataset.modalOpenCount = String(nextCount);
        return;
      }

      document.body.style.overflow = document.body.dataset.modalPrevOverflow || '';
      delete document.body.dataset.modalOpenCount;
      delete document.body.dataset.modalPrevOverflow;
      document.body.classList.remove('modal-open');
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="m-overlay" onClick={onClose}>
      <div className={`m-body ${className}`} onClick={(e) => e.stopPropagation()}>
        <div className="m-header">
          <div className="m-header-left">
            {headerLeftActions}
            {onBack && (
              <button className="m-back-btn" onClick={onBack}>‹ {backLabel || t('common.back')}</button>
            )}
          </div>
          {title && <span className="m-title">{title}</span>}
          <div className="m-header-right">
            {headerActions}
            <button className="m-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="m-content">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
