import { useState, useCallback, memo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTelegram } from '../../hooks/useTelegram';
import { t } from '../../i18n';
import { ItemTypeIcon, Skull, CoinIcon, Package } from '../../icons';

const RARITY_COLORS = {
  common: '#9e9e9e', rare: '#2196f3', epic: '#9c27b0', legendary: '#ffc107', mythical: '#f44336',
};

export default memo(function PirateEncounterCard({ encounter, onResolved }) {
  const pirateAction = useGameStore((s) => s.pirateAction);
  const user = useGameStore((s) => s.user);
  const storyData = useGameStore((s) => s.storyData);
  const { haptic, showConfirm, showAlert } = useTelegram();
  const [loading, setLoading] = useState(null);

  const expeditionId = encounter.expeditionId;
  const pirateInfo   = encounter.pirateInfo || {};
  const rarityColor  = RARITY_COLORS[pirateInfo.rarity] || '#9e9e9e';
  const voidCannon   = storyData?.items?.find((item) => item.key === 'void_cannon');
  const destroyCooldownUntil = voidCannon?.cooldownUntil ? new Date(voidCannon.cooldownUntil) : null;
  const destroyReady = !destroyCooldownUntil || destroyCooldownUntil <= new Date();

  const destroyCooldownText = !destroyReady && destroyCooldownUntil
    ? `${t('pirateCard.cannonRecharging')} · ${destroyCooldownUntil.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : null;

  const handlePay = useCallback(async () => {
    const stars = user?.starsBalance ?? 0;
    if (stars < 10) {
      await showAlert(t('pirate.payNoStars', { stars }));
      return;
    }
    const ok = await showConfirm(t('pirate.payConfirm'));
    if (!ok) return;
    setLoading('pay');
    haptic.impact('medium');
    try {
      const result = await pirateAction(expeditionId, 'pay');
      haptic.notification('success');
      onResolved(result);
    } catch (err) {
      haptic.notification('error');
      await showAlert(err.message || t('common.error'));
    } finally {
      setLoading(null);
    }
  }, [expeditionId, user?.starsBalance]);

  const handleFight = useCallback(async () => {
    const ok = await showConfirm(
      t('pirate.fightConfirm')
    );
    if (!ok) return;
    setLoading('fight');
    haptic.impact('heavy');
    try {
      const result = await pirateAction(expeditionId, 'fight');
      if (result.outcome === 'pirate_defeat') {
        haptic.notification('error');
        await showAlert(t('pirate.fightLose'));
      } else {
        haptic.notification('success');
      }
      onResolved(result);
    } catch (err) {
      haptic.notification('error');
      await showAlert(err.message || t('common.error'));
    } finally {
      setLoading(null);
    }
  }, [expeditionId]);

  const handleDestroy = useCallback(async () => {
    if (!destroyReady) return;
    const ok = await showConfirm(t('pirateCard.destroyConfirm'));
    if (!ok) return;
    setLoading('destroy');
    haptic.impact('heavy');
    try {
      const result = await pirateAction(expeditionId, 'destroy');
      haptic.notification('success');
      onResolved(result);
    } catch (err) {
      haptic.notification('error');
      await showAlert(err.message || t('common.error'));
    } finally {
      setLoading(null);
    }
  }, [destroyReady, expeditionId]);

  return (
    <div className="pirate-card anim-fadein-scale">
      <div className="pirate-header">
        <span className="pirate-skull"><Skull size={32} /></span>
        <h2 className="pirate-title">{t('pirate.title')}</h2>
        <p className="pirate-subtitle">{t('pirate.desc')}</p>
      </div>

      {pirateInfo.rarity && (
        <div className="pirate-cargo-preview" style={{ borderColor: rarityColor }}>
          <span className="cargo-icon">
            <ItemTypeIcon type={pirateInfo.findType} size={28} />
          </span>
          <div className="cargo-info">
            <span className="cargo-rarity" style={{ color: rarityColor }}>
              {pirateInfo.rarity?.toUpperCase()}
            </span>
            <span className="cargo-type">{pirateInfo.findType}</span>
            {pirateInfo.approximateValue > 0 && (
              <span className="cargo-value">~{pirateInfo.approximateValue} <CoinIcon size={12} style={{verticalAlign:'middle'}} /></span>
            )}
          </div>
        </div>
      )}

      <div className="pirate-choices">
        <button
          className="btn pirate-btn-pay btn-tap"
          onClick={handlePay}
          disabled={!!loading}
        >
          {loading === 'pay' ? <span className="spinner" /> : <>{t('pirate.payBtn')}</>}
        </button>

        <div className="pirate-or">{t('common.or')}</div>

        <button
          className="btn pirate-btn-fight btn-tap"
          onClick={handleFight}
          disabled={!!loading}
        >
          {loading === 'fight' ? <span className="spinner" /> : <>{t('pirate.fightBtn')}</>}
        </button>

        {voidCannon && destroyReady && (
          <>
            <div className="pirate-or">{t('common.or')}</div>
            <button
              className="btn pirate-btn-destroy btn-tap"
              onClick={handleDestroy}
              disabled={!!loading}
            >
              {loading === 'destroy' ? <span className="spinner" /> : <>{t('pirateCard.destroy')}</>}
            </button>
          </>
        )}
      </div>

      {destroyCooldownText && (
        <p className="pirate-hint">{destroyCooldownText}</p>
      )}

      <p className="pirate-hint">{t('pirate.cloakTip')}</p>
    </div>
  );
})
