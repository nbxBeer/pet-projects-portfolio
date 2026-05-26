import { useEffect, useState, memo } from 'react';
import { motion, AnimatePresence } from '../../utils/safeMotion';
import { useGameStore } from '../../store/gameStore';
import { t } from '../../i18n';

function FIND_LABELS() { return { asteroid: t('event.findTypes.asteroid'), debris: t('event.findTypes.debris'), artifact: t('event.findTypes.artifact'), creature: t('event.findTypes.creature'), anomaly: t('event.findTypes.anomaly') }; }
function RARITY_LABELS() {
  return {
    common: t('event.rarities.common'),
    rare: t('event.rarities.rare'),
    epic: t('event.rarities.epic'),
    legendary: t('event.rarities.legendary'),
    mythical: t('event.rarities.mythical'),
    exotic: t('event.rarities.exotic'),
    ancient: t('event.rarities.ancient'),
    relic: t('event.rarities.relic'),
    hybrid: t('event.rarities.hybrid'),
    singularity: t('event.rarities.singularity'),
  };
}

function formatEffect(e) {
  const zone = e.zones?.length ? ` (${e.zones.join(', ')})` : '';
  const pct = (m) => m >= 1 ? `+${Math.round((m - 1) * 100)}%` : `−${Math.round((1 - m) * 100)}%`;
  switch (e.type) {
    case 'xp_bonus':      return `🧬 XP ${pct(e.multiplier)}${zone}`;
    case 'credits_bonus': return `🪙 ${t('event.credits')} ${pct(e.multiplier)}${zone}`;
    case 'spawn_rate': {
      const what = e.findType ? (FIND_LABELS()[e.findType] || e.findType) : (t('collection.allTypes'));
      return `🔀 ${what} ×${e.multiplier}${zone}`;
    }
    case 'rarity_bonus': {
      const what = e.rarity ? (RARITY_LABELS()[e.rarity] || e.rarity) : t('event.nonLowest');
      return `✨ ${what} ×${e.multiplier}${zone}`;
    }
    case 'common_reduction': return `📈 ${t('event.rarities.common')} −${Math.round(e.reduction * 100)}%${zone}`;
    default: return e.type;
  }
}

function useCountdown(endsAt) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!endsAt) { setRemaining(0); return; }
    const update = () => setRemaining(Math.max(0, new Date(endsAt) - Date.now()));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [endsAt]);

  return remaining;
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}

export default memo(function EventBanner() {
  const event = useGameStore((s) => s.activeEvent);
  const [showInfo, setShowInfo] = useState(false);

  const remaining = useCountdown(event?.endsAt);

  if (!event || remaining === 0) return null;

  return (
    <div className="event-banner-wrap">
      <button
        className="event-btn"
        onClick={() => setShowInfo((v) => !v)}
        title={event.title}
      >
        <span className="event-btn-icon">{event.icon}</span>
        <span className="event-btn-timer">{formatCountdown(remaining)}</span>
      </button>

      <AnimatePresence>
        {showInfo && (
          <motion.div
            className="event-popup"
            initial={{ opacity: 0, scale: 0.85, x: -8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.85, x: -8 }}
            transition={{ duration: 0.15 }}
          >
            <div className="event-popup-title">{event.icon} {event.title}</div>
            {event.description && (
              <div className="event-popup-desc">{event.description}</div>
            )}
            {event.effects?.length > 0 && (
              <ul className="event-popup-effects">
                {event.effects.map((e, i) => <li key={i}>{formatEffect(e)}</li>)}
              </ul>
            )}
            <div className="event-popup-timer">{t('event.endsIn', { time: '' })} <strong>{formatCountdown(remaining)}</strong></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
})
