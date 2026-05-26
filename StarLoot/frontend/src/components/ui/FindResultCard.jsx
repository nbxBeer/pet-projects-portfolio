import { memo, useCallback, useRef, useState } from 'react';
import { t } from '../../i18n';
import { localizeCivilizationName, localizeItemName, localizeResourceName } from '../../i18n/entities';
import { useTelegram } from '../../hooks/useTelegram';
import { buildResultShareText } from '../../utils/itemShare';
import { captureCardImage } from '../../utils/itemShare';
import { useGameStore } from '../../store/gameStore';
import api from '../../services/api';
import { ItemTypeIcon, RarityDot, CoinIcon, CrystalIcon, Package, FlaskConical, Ruler, Dna, X, Check, Map } from '../../icons';

function getRarityConfig() {
  return {
    // U1
    common:      { label: t('rarity.common'),      color: '#9e9e9e', glow: 'rgba(158,158,158,0.3)', priceMult: 1.0,  xpMult: 1.0  },
    rare:        { label: t('rarity.rare'),        color: '#2196f3', glow: 'rgba(33,150,243,0.4)',  priceMult: 2.0,  xpMult: 1.8  },
    epic:        { label: t('rarity.epic'),        color: '#9c27b0', glow: 'rgba(156,39,176,0.5)',  priceMult: 4.0,  xpMult: 3.5  },
    legendary:   { label: t('rarity.legendary'),   color: '#ffc107', glow: 'rgba(255,193,7,0.6)',   priceMult: 8.0,  xpMult: 8.0  },
    mythical:    { label: t('rarity.mythical'),    color: '#f44336', glow: 'rgba(244,67,54,0.7)',   priceMult: 20.0, xpMult: 18.0 },
    // U2 extra tiers
    exotic:      { label: t('rarity.exotic'),      color: '#26c6da', glow: 'rgba(38,198,218,0.4)',  priceMult: 1.5,  xpMult: 1.5  },
    ancient:     { label: t('rarity.ancient'),     color: '#8d6e63', glow: 'rgba(141,110,99,0.4)',  priceMult: 4.0,  xpMult: 4.0  },
    relic:       { label: t('rarity.relic'),       color: '#ff7043', glow: 'rgba(255,112,67,0.5)',  priceMult: 9.0,  xpMult: 9.0  },
    hybrid:      { label: t('rarity.hybrid'),      color: '#ab47bc', glow: 'rgba(171,71,188,0.5)',  priceMult: 20.0, xpMult: 20.0 },
    singularity: { label: t('rarity.singularity'), color: '#e040fb', glow: 'rgba(224,64,251,0.6)',  priceMult: 50.0, xpMult: 50.0 },
  };
}


const TYPE_LABEL_KEYS = {
  debris:        'findTypeSingle.debris',
  artifact:      'findTypeSingle.artifact',
  creature:      'findTypeSingle.creature',
  anomaly:       'findTypeSingle.anomaly',
  asteroid:      'findTypeSingle.asteroid',
  nft_container: 'findTypeSingle.nft_container',
  story_item:    'findTypeSingle.story_item',
  // U2
  echo:          'findTypeSingle.echo',
  relic:         'findTypeSingle.relic',
  entity:        'findTypeSingle.entity',
  rift:          'findTypeSingle.rift',
};

const FindResultCard = memo(function FindResultCard({ result }) {
  const RARITY_CONFIG = getRarityConfig();
  const { haptic } = useTelegram();
  const userId = useGameStore((s) => s.user?.id);
  const currentUniverse = useGameStore((s) => s.user?.currentUniverse || 1);
  const [shareToast, setShareToast] = useState(null);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef(null);
  const { outcome } = result;

  const rc = RARITY_CONFIG[result.rarity] || RARITY_CONFIG.common;
  const SaleIcon = currentUniverse === 2 ? CrystalIcon : CoinIcon;
  const sellPrice = result.sellPrice != null
    ? result.sellPrice
    : (result.findType === 'asteroid'
      ? (result.objectData?.scanned ? Math.round(Number(result.baseCredits) * 0.2) : 125)
      : Math.round(Number(result.baseCredits) * rc.priceMult));

  const showShareToast = useCallback((message, type = 'ok') => {
    setShareToast({ message, type });
    setTimeout(() => setShareToast(null), 2200);
  }, []);
  const isStoryItem = result.findType === 'story_item';

  const handleShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    const shareText = buildResultShareText(result, sellPrice, { refUserId: userId });
    let imageBase64 = null;
    try {
      imageBase64 = await captureCardImage(cardRef.current);
    } catch {}
    try {
      const res = await api.post('/user/share-message', { text: shareText, image: imageBase64 });
      if (res?.ok) {
        haptic?.notification?.('success');
        showShareToast(t('share.sentToDm'));
        return;
      }

      if (res?.reason === 'dm_unavailable') {
        haptic?.notification?.('warning');
        showShareToast(t('share.openBotFirst'), 'err');
        return;
      }

      if (res?.reason === 'bot_unavailable') {
        haptic?.notification?.('warning');
        showShareToast(t('share.botUnavailable'), 'err');
        return;
      }

      haptic?.notification?.('error');
      showShareToast(t('share.sendFailed'), 'err');
    } catch (err) {
      console.error('share_message_failed', {
        status: err?.status,
        message: err?.message,
        data: err?.data,
      });

      if (err?.status === 404) {
        haptic?.notification?.('warning');
        showShareToast(t('share.backendOutdated'), 'err');
        return;
      }
      if (err?.status === 401) {
        haptic?.notification?.('warning');
        showShareToast(t('share.authExpired'), 'err');
        return;
      }
      if (err?.status === 503 || err?.data?.reason === 'bot_unavailable') {
        haptic?.notification?.('warning');
        showShareToast(t('share.botUnavailable'), 'err');
        return;
      }
      if (err?.message) {
        haptic?.notification?.('error');
        showShareToast(err.message, 'err');
        return;
      }
      haptic?.notification?.('error');
      showShareToast(t('share.sendFailed'), 'err');
    } finally {
      setSharing(false);
    }
  }, [haptic, result, sellPrice, sharing, showShareToast, userId]);

  // Outcome banners
  if (outcome === 'cargo_full') {
    const itemName = localizeItemName({
      objectData: result.objectData,
      templateId: result.objectData?.templateId,
      fallback: t('findResult.unknownObject'),
    });
    const coins = result.creditsGained || 0;
    const itemVol = result.itemVolume ?? result.objectData?.volume ?? '?';
    const cargoMax = result.cargoMaxVolume ?? '?';
    return (
      <div className="find-card find-card-warning anim-fadein-scale">
        <div className="find-icon"><Package size={40} /></div>
        <h3 className="find-name">{t('findResult.cargoFull')}</h3>
        <p className="find-outcome-text">
          {t('findResult.cargoFullDesc', { name: itemName, rarity: rc.label, credits: coins })}
        </p>
        <div className="find-volume-hint">
          <Ruler size={13} style={{verticalAlign:'middle',marginRight:3}} />{t('findResult.volumeHint', { itemVol, cargoMax })} ({itemVol} &gt; {cargoMax} {t('units.m3')})
        </div>
        <div className="rewards-row">
          <span className="reward-chip"><CoinIcon size={13} style={{verticalAlign:'middle',marginRight:3}} />+{coins}</span>
          <span className="reward-chip"><Dna size={13} style={{verticalAlign:'middle',marginRight:3}} />+{result.xpGained || 0} XP</span>
        </div>
      </div>
    );
  }

  if (outcome === 'no_capsule') {
    return (
      <div className="find-card find-card-warning anim-fadein-scale">
        <div className="find-icon"><FlaskConical size={40} /></div>
        <h3 className="find-name">{t('findResult.noCapsule')}</h3>
        <p className="find-outcome-text">
          {t('findResult.noCapsuleDesc', { rarity: rc.label })}
        </p>
        <div className="rewards-row">
          <span className="reward-chip"><Dna size={13} style={{verticalAlign:'middle',marginRight:3}} />+{result.xpGained || 0} XP</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="find-card anim-fadein-scale"
      style={{ '--glow-color': rc.glow, '--rarity-color': rc.color }}
    >
      {shareToast && (
        <div className="sell-toast-banner">
          <div className={`sell-toast-pill ${shareToast.type === 'err' ? 'sell-toast-pill--err' : ''}`}>
            {shareToast.type === 'err'
              ? <X size={13} style={{verticalAlign:'middle',marginRight:4}} />
              : <Check size={13} style={{verticalAlign:'middle',marginRight:4}} />}
            {shareToast.message}
          </div>
        </div>
      )}

      <button className="share-icon-btn find-card-share-btn" type="button" onClick={handleShare} disabled={sharing} title={t('share.title')}>
        {sharing ? <span className="spinner" style={{width:16,height:16}} /> : (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14 3a1 1 0 0 0 0 2h3.59l-9.3 9.3a1 1 0 1 0 1.42 1.4l9.29-9.29V10a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-6z" />
            <path d="M5 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 1 0-2 0v5H5V7h5a1 1 0 1 0 0-2H5z" />
          </svg>
        )}
      </button>

      {/* Gene enhancer proc banner */}
      {result.geneEnhancerProc && (() => {
        const { originalRarity, upgradedRarity } = result.geneEnhancerProc;
        const origCfg = RARITY_CONFIG[originalRarity] || RARITY_CONFIG.common;
        const upgCfg  = RARITY_CONFIG[upgradedRarity] || RARITY_CONFIG.rare;
        return (
          <div className="gene-enhancer-banner">
            <span className="gene-enhancer-label">{t('exhibition.geneEnhancer')}</span>
            <span className="gene-enhancer-upgrade">
              <span style={{ color: origCfg.color }}>{origCfg.label}</span>
              {' -> '}
              <span style={{ color: upgCfg.color }}>{upgCfg.label}</span>
            </span>
          </div>
        );
      })()}

      {/* Rarity badge */}
      <div className="rarity-badge" style={{ color: rc.color }}>
        <RarityDot color={rc.color} size={10} style={{ marginRight: 5, verticalAlign: 'middle' }} /> {rc.label}
      </div>

      {/* Object type icon */}
      <div className="find-icon"><ItemTypeIcon type={result.findType} size={40} /></div>

      {/* Object name */}
      <h3 className="find-name">{localizeItemName({
        objectData: result.objectData,
        templateId: result.objectData?.templateId,
        fallback: t('findResult.unknownObject'),
      })}</h3>

      {/* Details */}
      <div className="find-details">
        <DetailRow
          label={t('findResult.type')}
          value={TYPE_LABEL_KEYS[result.findType] ? t(TYPE_LABEL_KEYS[result.findType]) : (result.findType || t('findResult.unknown'))}
        />
        {isStoryItem && result.objectData?.description && (
          <DetailRow label={t('findResult.contents')} value={result.objectData.description} />
        )}
        {result.findType === 'debris' && (
          <>
            {result.objectData?.mass   && <DetailRow label={t('findResult.mass')}  value={`${result.objectData.mass} ${t('units.kg')}`} />}
            {result.objectData?.volume && <DetailRow label={t('findResult.volume')}  value={`${result.objectData.volume} ${t('units.m3')}`} />}
          </>
        )}
        {result.findType === 'artifact' && (
          <>
            {result.objectData?.race && <DetailRow label={t('findResult.race')}  value={localizeCivilizationName(result.objectData.race)} />}
            {result.objectData?.mass && <DetailRow label={t('findResult.mass')} value={`${result.objectData.mass} ${t('units.kg')}`} />}
          </>
        )}
        {result.findType === 'creature' && (
          <>
            {result.objectData?.mass && <DetailRow label={t('findResult.mass')} value={`${result.objectData.mass} ${t('units.kg')}`} />}
            <DetailRow label={t('findResult.sentience')} value={result.objectData?.isIntelligent ? t('findResult.sentienceYes') : t('findResult.sentienceNo')} />
          </>
        )}
        {result.findType === 'anomaly' && (
          <>
            {result.objectData?.mass && <DetailRow label={t('findResult.mass')} value={`${result.objectData.mass} ${t('units.kg')}`} />}
            <DetailRow label={t('findResult.container')} value={`${result.objectData?.containerIntegrity}%`} />
          </>
        )}
        {result.findType === 'asteroid' && (
          <>
            <DetailRow
              label={t('findResult.resourceType')}
              value={result.objectData?.scanned
                ? localizeResourceName(result.objectData.resourceName, result.objectData.resourceType)
                : t('findResult.needScanner')}
            />
            <DetailRow
              label={t('findResult.miningVolume')}
              value={result.objectData?.scanned ? `${result.objectData.estimatedVolume} ${t('units.t')}` : t('findResult.unknown')}
            />
            {result.objectData?.scanned && (
              <DetailRow label={t('findResult.condition')} value={`${result.objectData.condition}%`} />
            )}
          </>
        )}
        {result.findType === 'nft_container' && (
          <DetailRow label={t('findResult.contents')} value={result.objectData?.outcomeLabel || t('findResult.contentsUnknown')} />
        )}
        {/* U2 find types */}
        {result.findType === 'echo' && (
          <>
            {result.objectData?.mass   && <DetailRow label={t('findResult.mass')}   value={`${result.objectData.mass} ${t('units.kg')}`} />}
            {result.objectData?.volume && <DetailRow label={t('findResult.volume')} value={`${result.objectData.volume} ${t('units.m3')}`} />}
          </>
        )}
        {result.findType === 'relic' && (
          <>
            {result.objectData?.race && <DetailRow label={t('findResult.race')} value={result.objectData.race} />}
            {result.objectData?.mass && <DetailRow label={t('findResult.mass')} value={`${result.objectData.mass} ${t('units.kg')}`} />}
          </>
        )}
        {result.findType === 'entity' && (
          <>
            {result.objectData?.mass && <DetailRow label={t('findResult.mass')} value={`${result.objectData.mass} ${t('units.kg')}`} />}
            <DetailRow
              label={t('findResult.sentience')}
              value={result.objectData?.isIntelligent ? t('findResult.sentienceYes') : t('findResult.sentienceNo')}
            />
          </>
        )}
        {result.findType === 'rift' && (
          <>
            {result.objectData?.mass && <DetailRow label={t('findResult.mass')} value={`${result.objectData.mass} ${t('units.kg')}`} />}
            {result.objectData?.containerIntegrity != null && (
              <DetailRow label={t('findResult.container')} value={`${result.objectData.containerIntegrity}%`} />
            )}
          </>
        )}
      </div>

      {/* Rewards preview */}
      {!isStoryItem && (
        <div className="rewards-row">
          <span className="reward-chip">
            <SaleIcon size={13} style={{verticalAlign:'middle',marginRight:3}} /> {sellPrice.toLocaleString()}
            {result.crossUniverseBonus && (
              <span className="cross-universe-bonus">{t('universe.crossBonus')}</span>
            )}
          </span>
          <span className="reward-chip"><Dna size={13} style={{verticalAlign:'middle',marginRight:3}} />{
            result.displayXP != null ? result.displayXP : Math.round(result.baseXP * rc.xpMult)
          } XP</span>
        </div>
      )}
    </div>
  );
});

export default FindResultCard;

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}

// ─── ActionButtons.jsx ────────────────────────────────────────────────────────
export const ActionButtons = memo(function ActionButtons({ result, onSell, onAction, onDismiss, loadingAction }) {
  const currentUniverse = useGameStore((s) => s.user?.currentUniverse || 1);
  const sellLabel = currentUniverse === 2 ? t('findResult.sellCrystals') : t('findResult.sell');
  const SaleIcon = currentUniverse === 2 ? CrystalIcon : CoinIcon;
  const { findType, outcome } = result || {};
  const isNFT = findType === 'nft_container';
  const isAsteroid = findType === 'asteroid';
  const isStoryItem = findType === 'story_item';

  // Auto-complete outcomes (cargo_full / no_capsule) — XP already awarded, just close
  if (outcome === 'cargo_full' || outcome === 'no_capsule') {
    return (
      <div className="action-buttons">
        <button className="btn btn-secondary btn-tap" onClick={onDismiss}>
          {t('findResult.closeBtn')}
        </button>
      </div>
    );
  }

  // NFT container: only save (collect into inventory)
  if (isNFT) {
    return (
      <div className="action-buttons">
        <button
          className="btn btn-collect btn-tap"
          onClick={() => onAction('save_coords')}
          disabled={!!loadingAction}
        >
          {loadingAction === 'save_coords' ? <span className="spinner" /> : <><Package size={14} style={{verticalAlign:'middle',marginRight:5}} />{t('findResult.saveCollection')}</>}
        </button>
      </div>
    );
  }

  // Asteroid: sell or save coords
  if (isAsteroid) {
    return (
      <div className="action-buttons">
        <button
          className="btn btn-sell btn-tap"
          onClick={() => onAction('sell')}
          disabled={!!loadingAction}
        >
          {loadingAction === 'sell' ? <span className="spinner" /> : <><SaleIcon size={14} style={{verticalAlign:'middle',marginRight:5}} />{sellLabel}</>}
        </button>
        <button
          className="btn btn-secondary btn-tap"
          onClick={() => onAction('save_coords')}
          disabled={!!loadingAction}
        >
          {loadingAction === 'save_coords' ? <span className="spinner" /> : <><Map size={14} style={{verticalAlign:'middle',marginRight:5}} />{t('findResult.saveCoords')}</>}
        </button>
      </div>
    );
  }

  if (isStoryItem) {
    return (
      <div className="action-buttons">
        <button
          className="btn btn-collect btn-tap"
          onClick={onDismiss}
          disabled={!!loadingAction}
        >
          {loadingAction === 'collect' ? <span className="spinner" /> : <><Package size={14} style={{verticalAlign:'middle',marginRight:5}} />{t('findResult.collect')}</>}
        </button>
      </div>
    );
  }

  // Non-asteroid: sell or collect
  return (
    <div className="action-buttons">
      <button
        className="btn btn-sell btn-tap"
        onClick={onSell}
        disabled={!!loadingAction}
      >
        {loadingAction === 'sell' ? <span className="spinner" /> : <><SaleIcon size={14} style={{verticalAlign:'middle',marginRight:5}} />{sellLabel}</>}
      </button>
      <button
        className="btn btn-collect btn-tap"
        onClick={onDismiss}
        disabled={!!loadingAction}
      >
        {loadingAction === 'collect' ? <span className="spinner" /> : <><Package size={14} style={{verticalAlign:'middle',marginRight:5}} />{t('findResult.collect')}</>}
      </button>
    </div>
  );
});
