'use strict';
import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { t } from '../../i18n';
import Modal from './Modal';

/**
 * Formats a countdown (ms) as HH:MM:SS or MM:SS.
 */
function formatCountdown(ms) {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function UniverseModal({ onClose }) {
  const user = useGameStore((s) => s.user);
  const expedition = useGameStore((s) => s.expedition);
  const startUniverseTravel = useGameStore((s) => s.startUniverseTravel);
  const completeUniverseTravel = useGameStore((s) => s.completeUniverseTravel);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [travelRemaining, setTravelRemaining] = useState(0);
  const [selectedUniverse, setSelectedUniverse] = useState(null);

  const currentUniverse = user?.currentUniverse || 1;
  const hasUniverse2Access = Boolean(user?.hasUniverse2Access || currentUniverse === 2);
  const availableUniverses = hasUniverse2Access ? [1, 2] : [1];
  const travelUntil = user?.universeTravelUntil ? new Date(user.universeTravelUntil) : null;
  const isTraveling = travelUntil && travelUntil > new Date();
  const travelDone = travelUntil && travelUntil <= new Date();
  const hasActiveExpedition = expedition && (expedition.status === 'in_progress' || expedition.status === 'pirate_pending');

  useEffect(() => {
    const fallbackTarget = currentUniverse === 1 && hasUniverse2Access ? 2 : 1;
    const preferred = selectedUniverse && availableUniverses.includes(selectedUniverse)
      ? selectedUniverse
      : fallbackTarget;
    setSelectedUniverse(preferred);
  }, [currentUniverse, hasUniverse2Access]);

  // Countdown timer
  useEffect(() => {
    if (!isTraveling) { setTravelRemaining(0); return; }
    const tick = () => setTravelRemaining(Math.max(0, travelUntil - new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [travelUntil?.getTime(), isTraveling]);

  const handleTravel = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (travelDone) {
        await completeUniverseTravel();
      } else {
        await startUniverseTravel();
      }
      onClose?.();
    } catch (e) {
      setError(e.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [travelDone, startUniverseTravel, completeUniverseTravel, onClose]);

  const targetUniverse = selectedUniverse;
  const canTravel = Boolean(targetUniverse) && targetUniverse !== currentUniverse && !isTraveling && !hasActiveExpedition;
  const travelHours = user?.hasHaulerTravelReducer ? 3 : 6;
  const travelMeta = t('universe.travelMetaLabel', { hours: travelHours });

  return (
    <Modal open title={t('universe.title')} onClose={onClose}>
      <div className="universe-modal-content">
        {/* Current universe */}
        <div className="universe-current-label">
          {currentUniverse === 1 ? t('universe.currentU1') : t('universe.currentU2')}
        </div>

        <div className="zones-list" style={{ marginBottom: 10 }}>
          {availableUniverses.map((universeId) => {
            const isCurrent = universeId === currentUniverse;
            const isSelected = universeId === targetUniverse;
            return (
              <button
                key={universeId}
                type="button"
                className={`zone-item ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedUniverse(universeId)}
              >
                <div className="zone-item-info">
                  <span className="zone-item-name">
                    {universeId === 1 ? t('universe.u1') : t('universe.u2')}
                  </span>
                  <span className="zone-item-level">
                    {isCurrent ? t('universe.current') : t('universe.available')}
                  </span>
                </div>
                <div className="zone-item-stats">
                  {isCurrent ? '📍' : '🌀'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Active expedition blocker */}
        {hasActiveExpedition && (
          <div className="universe-info-row" style={{ borderColor: 'rgba(239,68,68,0.3)', border: '1px solid' }}>
            <span className="info-icon">🚀</span>
            <span className="info-text" style={{ color: '#ef4444' }}>{t('universe.activeExpedition')}</span>
          </div>
        )}

        {/* Travel timer */}
        {isTraveling && (
          <div className="universe-travel-timer">
            {t('universe.travelTimer').replace('{time}', formatCountdown(travelRemaining))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ color: '#ef4444', textAlign: 'center', fontSize: 13, marginTop: 8 }}>
            {error}
          </div>
        )}

        {/* Travel button */}
        {travelDone ? (
          <button className="universe-travel-btn arrive-btn" onClick={handleTravel} disabled={loading}>
            {loading ? '...' : t('universe.arrive')}
          </button>
        ) : !isTraveling ? (
          <button
            className="universe-travel-btn"
            onClick={handleTravel}
            disabled={loading || !canTravel}
          >
            {loading ? '...' : (
              <>
                <span>{targetUniverse === 2 ? t('universe.travelToU2') : t('universe.travelToU1')}</span>
                <span className="universe-travel-meta">{travelMeta}</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
