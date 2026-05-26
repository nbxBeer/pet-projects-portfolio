import { useState, memo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from '../../utils/safeMotion';
import { useGameStore } from '../../store/gameStore';
import { t } from '../../i18n';
import { Sparkles, ScannerIcon, Shield, Zap, ScrollText, Map, Telescope } from '../../icons';

// Constant outside component — not recreated on every render
const HIDDEN_BUFF_TYPES = ['force_rarity', 'force_type', 'remote_scanner'];

function getBuffLabels() {
  return {
    signal_amplifier: t('buff.signal_amplifier'),
    stealth_module:   t('buff.stealth_module'),
    turbo_engine:     t('buff.turbo_engine'),
    insurance_policy: t('buff.insurance_policy'),
    cartographer:     t('buff.cartographer'),
    quantum_locator:  t('buff.quantum_locator'),
  };
}

const BUFF_ICONS = {
  signal_amplifier: ScannerIcon,
  stealth_module:   Shield,
  turbo_engine:     Zap,
  insurance_policy: ScrollText,
  cartographer:     Map,
  quantum_locator:  Telescope,
};

function formatExpiry(buff) {
  if (buff.expires_at) {
    const ms = new Date(buff.expires_at) - Date.now();
    if (ms <= 0) return t('buff.expired');
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return t('buff.timeLeft', { h, m });
  }
  if (buff.uses_remaining != null) {
    return t('buff.usesLeft', { uses: buff.uses_remaining });
  }
  return '';
}

export default memo(function ActiveBuffsBar() {
  const activeBuffs = useGameStore((s) => s.activeBuffs);
  const loadActiveBuffs = useGameStore((s) => s.loadActiveBuffs);
  const [open, setOpen] = useState(false);
  // Local tick to re-render time display without hitting the API
  const [, setTick] = useState(0);

  // Re-render every 30s to keep countdown accurate — no network call
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Refresh buff list from API every 2 minutes (was every 5 seconds)
  useEffect(() => {
    const id = setInterval(() => loadActiveBuffs(), 120_000);
    return () => clearInterval(id);
  }, [loadActiveBuffs]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Only show valid, non-service buffs
  const valid = activeBuffs.filter((b) => {
    if (HIDDEN_BUFF_TYPES.includes(b.buff_type)) return false;
    if (b.expires_at && new Date(b.expires_at) <= Date.now()) return false;
    if (b.uses_remaining != null && b.uses_remaining <= 0) return false;
    return true;
  });

  if (valid.length === 0) return null;

  return (
    <div className="active-buffs-bar">
      <button className="active-buffs-btn" onClick={toggle}>
        <span className="buffs-btn-icon"><Sparkles size={16} /></span>
        <span className="buffs-btn-text">{t('buff.activeBuffs', { count: valid.length })}</span>
        <span className="buffs-btn-arrow">{open ? '▲' : '▼'}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="active-buffs-dropdown"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            {valid.map((buff) => {
              const BuffIcon = BUFF_ICONS[buff.buff_type];
              return (
                <div key={buff.id} className="active-buff-row">
                  <span className="active-buff-label">
                    {BuffIcon && <BuffIcon size={14} style={{ verticalAlign: 'middle', marginRight: 5, flexShrink: 0 }} />}
                    {getBuffLabels()[buff.buff_type] || buff.buff_type}
                  </span>
                  <span className="active-buff-time">{formatExpiry(buff)}</span>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
})
