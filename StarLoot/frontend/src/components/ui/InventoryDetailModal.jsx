import { useState, useContext, useRef, useEffect } from 'react';
import Modal from './Modal';
import api, { userApi } from '../../services/api';
import { useGameStore } from '../../store/gameStore';
import { useTelegram } from '../../hooks/useTelegram';
import { CollectionToastContext } from '../panels/CollectionPanel';
import { t, isRu } from '../../i18n';
import { localizeCivilizationName, localizeItemName, localizeResourceName } from '../../i18n/entities';
import { buildInventoryShareText, captureCardImage } from '../../utils/itemShare';
import { ItemTypeIcon, RarityDot, CoinIcon, CrystalIcon, Satellite, X, Check, ExhibitionIcon } from '../../icons';
import ExhibitionResultModal from './ExhibitionResultModal';

function getRarityConfig() {
  return {
    common:      { label: t('rarity.common'),      color: '#9e9e9e', priceMult: 1.0  },
    rare:        { label: t('rarity.rare'),        color: '#2196f3', priceMult: 2.0  },
    epic:        { label: t('rarity.epic'),        color: '#9c27b0', priceMult: 4.0  },
    legendary:   { label: t('rarity.legendary'),   color: '#ffc107', priceMult: 8.0  },
    mythical:    { label: t('rarity.mythical'),    color: '#f44336', priceMult: 20.0 },
    // U2
    exotic:      { label: t('rarity.exotic'),      color: '#26c6da', priceMult: 1.5  },
    ancient:     { label: t('rarity.ancient'),     color: '#8d6e63', priceMult: 4.0  },
    relic:       { label: t('rarity.relic'),       color: '#ff7043', priceMult: 9.0  },
    hybrid:      { label: t('rarity.hybrid'),      color: '#ab47bc', priceMult: 20.0 },
    singularity: { label: t('rarity.singularity'), color: '#e040fb', priceMult: 50.0 },
  };
}

function getTypeLabels() {
  return {
    debris: t('findTypeSingle.debris'),
    artifact: t('findTypeSingle.artifact'),
    creature: t('findTypeSingle.creature'),
    anomaly: t('findTypeSingle.anomaly'),
    asteroid: t('findTypeSingle.asteroid'),
    nft_container: t('findTypeSingle.nft_container'),
    // U2
    echo: t('findTypeSingle.echo'),
    relic: t('findTypeSingle.relic'),
    entity: t('findTypeSingle.entity'),
    rift: t('findTypeSingle.rift'),
  };
}

function Row({ label, value, muted }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value" style={muted ? { color:'var(--text-muted)', fontStyle:'italic' } : {}}>{value}</span>
    </div>
  );
}

function formatCoords(coords) {
  if (!coords) return '—';
  const num = String(Math.round(coords.x)).padStart(3, '0');
  const letter = String.fromCharCode(65 + Math.floor(coords.z % 26));
  return `${coords.sector}-${num}-${letter}`;
}

function TypeDetails({ findType, od }) {
  if (!od) return null;
  if (findType === 'debris')   return (<>{od.mass!=null&&<Row label={t('findResult.mass')} value={`${od.mass} ${t('units.kg')}`}/>}{od.volume!=null&&<Row label={t('findResult.volume')} value={`${od.volume} ${t('units.m3')}`}/>}</>);
  if (findType === 'artifact') return (<>{od.race&&<Row label={t('inventory.civilization')} value={localizeCivilizationName(od.race)}/>}{od.mass!=null&&<Row label={t('findResult.mass')} value={`${od.mass} ${t('units.kg')}`}/>}</>);
  if (findType === 'creature') return (<><Row label={t('findResult.sentience')} value={od.isIntelligent?t('inventory.sentient'):t('inventory.nonSentient')}/>{od.mass!=null&&<Row label={t('findResult.mass')} value={`${od.mass} ${t('units.kg')}`}/>}</>);
  if (findType === 'anomaly')  return (<>{od.mass!=null&&<Row label={t('inventory.containerMass')} value={`${od.mass} ${t('units.kg')}`}/>}{od.containerIntegrity!=null&&<Row label={t('inventory.integrity')} value={`${od.containerIntegrity}%`}/>}</>);
  if (findType === 'asteroid') {
    const h = !od.scanned;
    return (<>
      <Row label={t('inventory.coords')} value={formatCoords(od.coordinates)}/>
      <Row label={t('inventory.resource')}     value={h ? t('findResult.unknown') : localizeResourceName(od.resourceNameEn || od.resourceName, od.resourceType)} muted={h}/>
      <Row label={t('findResult.condition')}  value={h?t('findResult.unknown'):`${od.condition}%`} muted={h}/>
      <Row label={t('findResult.volume')}      value={h?t('findResult.unknown'):`${Number(od.estimatedVolume).toLocaleString()} ${t('units.t')}`} muted={h}/>
    </>);
  }
  if (findType === 'nft_container') {
    return <Row label={t('findResult.contents')} value={od.outcomeLabel || t('findResult.contentsUnknown')}/>;
  }
  // U2 find types
  if (findType === 'echo')   return (<>{od.mass!=null&&<Row label={t('findResult.mass')} value={`${od.mass} ${t('units.kg')}`}/>}{od.volume!=null&&<Row label={t('findResult.volume')} value={`${od.volume} ${t('units.m3')}`}/>}</>);
  if (findType === 'relic')  return (<>{od.race&&<Row label={t('inventory.civilization')} value={od.race}/>}{od.mass!=null&&<Row label={t('findResult.mass')} value={`${od.mass} ${t('units.kg')}`}/>}</>);
  if (findType === 'entity') return (<><Row label={t('findResult.sentience')} value={od.isIntelligent?t('inventory.sentient'):t('inventory.nonSentient')}/>{od.mass!=null&&<Row label={t('findResult.mass')} value={`${od.mass} ${t('units.kg')}`}/>}</>);
  if (findType === 'rift')   return (<>{od.mass!=null&&<Row label={t('inventory.containerMass')} value={`${od.mass} ${t('units.kg')}`}/>}{od.containerIntegrity!=null&&<Row label={t('inventory.integrity')} value={`${od.containerIntegrity}%`}/>}</>);
  return null;
}

const EXHIBITION_ELIGIBLE_TYPES = new Set(['artifact', 'relic']);
const EXHIBITION_ELIGIBLE_RARITIES = new Set(['legendary', 'mythical', 'hybrid', 'singularity']);

function fmtCountdown(ms) {
  if (ms == null || ms < 0) return '—';
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

export default function InventoryDetailModal({ item: initialItem, onClose, onSold, onScanned }) {
  const [loading, setLoading]         = useState(false);
  const [scanning, setScanning]       = useState(false);
  const [sharing, setSharing]         = useState(false);
  const [exhibiting, setExhibiting]   = useState(false);
  const [exhibitionResult, setExhibitionResult] = useState(null);
  const [exhTimeLeft, setExhTimeLeft] = useState(null);
  const [item, setItem]               = useState(initialItem);
  const [toast, setToast]             = useState(null);
  const cardContentRef                = useRef(null);
  const { haptic } = useTelegram();
  const { updateCredits, updateCrystals, activeBuffs, loadActiveBuffs, user,
          storyData, exhibitionStatus, sendToExhibition, collectExhibition, loadExhibitionStatus } = useGameStore();

  // Compute these early — used in useEffect dependency arrays below
  const exhibitionActive     = exhibitionStatus?.isActive;
  const isThisOnExhibition   = exhibitionStatus?.inventoryItemId === item.id && !!exhibitionActive;
  const exhibitionReady      = !!exhibitionStatus?.isReady && isThisOnExhibition;

  useEffect(() => {
    if (storyData?.items?.some(i => i.key === 'exhibition_pass')) {
      loadExhibitionStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown timer
  useEffect(() => {
    const endsAt = exhibitionStatus?.endsAt;
    const active = exhibitionStatus?.isActive && !exhibitionStatus?.isReady;
    if (!isThisOnExhibition || !active || !endsAt) { setExhTimeLeft(null); return; }
    const tick = () => { const ms = Math.max(0, new Date(endsAt) - Date.now()); setExhTimeLeft(ms); return ms; };
    tick();
    const id = setInterval(() => { if (tick() === 0) clearInterval(id); }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhibitionStatus?.endsAt, exhibitionStatus?.isActive, exhibitionStatus?.isReady, isThisOnExhibition]);


  const collectionToast = useContext(CollectionToastContext);

  const showToast = (msg, type='ok') => {
    if (collectionToast) collectionToast(msg, type);
    else { setToast({msg,type}); setTimeout(()=>setToast(null),1200); }
  };

  const RARITY_CONFIG = getRarityConfig();
  const TYPE_LABELS = getTypeLabels();

  const rc = RARITY_CONFIG[item.rarity] || RARITY_CONFIG.common;
  const od = item.object_data || {};
  const saleCurrency = user?.currentUniverse === 2 ? 'crystals' : 'credits';
  const SaleIcon = saleCurrency === 'crystals' ? CrystalIcon : CoinIcon;
  const sellLabel = saleCurrency === 'crystals' ? t('findResult.sellCrystals') : t('findResult.sell');
  const localizedName = localizeItemName({ objectData: od, templateId: item.template_id, fallback: 'Object' });
  const sellPrice = item.sell_price != null
    ? item.sell_price
    : (item.find_type === 'asteroid'
      ? (od.scanned ? Math.round(Number(item.base_credits) * 0.2) : 125)
      : Math.round(Number(item.base_credits) * (rc.priceMult||1)));

  const scannerBuff  = activeBuffs.find(b=>b.buff_type==='remote_scanner');
  const scannerCount = scannerBuff?.uses_remaining ?? 0;
  const canRemoteScan = item.find_type==='asteroid' && !od.scanned && scannerCount>0;

  const hasExhibitionPass = storyData?.items?.some(i => i.key === 'exhibition_pass');
  const canExhibit = hasExhibitionPass
    && EXHIBITION_ELIGIBLE_TYPES.has(item.find_type)
    && EXHIBITION_ELIGIBLE_RARITIES.has(item.rarity)
    && item.status !== 'on_exhibition';

  const handleExhibit = async () => {
    if (exhibiting) return;
    setExhibiting(true);
    haptic?.impact?.('medium');
    try {
      if (exhibitionReady) {
        const result = await collectExhibition();
        haptic?.notification?.(result.outcome === 'stolen' ? 'error' : 'success');
        updateCredits?.(result.creditsRemaining);
        setExhibitionResult(result);
      } else {
        await sendToExhibition(item.id);
        haptic?.notification?.('success');
        showToast(t('exhibition.sent'));
        await loadExhibitionStatus();
      }
    } catch (err) {
      haptic?.notification?.('error');
      showToast(err?.response?.data?.error || err?.message || t('common.error'), 'err');
    } finally {
      setExhibiting(false);
    }
  };

  const handleSell = async () => {
    if (loading) return;
    setLoading(true);
    haptic?.impact?.('medium');
    try {
      const result = await userApi.sellInventoryItem(item.id);
      haptic?.notification?.('success');
      if (result.saleCurrency === 'crystals') {
        updateCrystals(result.crystalsRemaining);
      } else {
        updateCredits(result.creditsRemaining);
      }
      showToast(<span>{t('inventory.soldLabel')}<SaleIcon size={12} style={{verticalAlign:'middle',marginRight:2}} />+{result.sellPrice.toLocaleString()}</span>);
      setTimeout(() => onSold?.(), 700);
    } catch (err) {
      haptic?.notification?.('error');
      showToast(err.message||t('inventory.sellError'), 'err');
      setLoading(false);
    }
  };

  const handleRemoteScan = async () => {
    if (scanning) return;
    setScanning(true);
    haptic?.impact?.('medium');
    try {
      const result = await userApi.remoteScanAsteroid(item.id);
      haptic?.notification?.('success');
      setItem(result.item);
      loadActiveBuffs();
      onScanned?.(result.item, result.scannersRemaining);
    } catch (err) {
      haptic?.notification?.('error');
      showToast(err.message||t('inventory.scanError'), 'err');
    } finally {
      setScanning(false);
    }
  };

  const showShareToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    const shareText = buildInventoryShareText(item, sellPrice, { refUserId: user?.id });
    let imageBase64 = null;
    try {
      imageBase64 = await captureCardImage(cardContentRef.current);
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
  };

  const shareHeaderBtn = (
    <button className="share-icon-btn" type="button" onClick={handleShare} disabled={sharing} title={t('share.title')}>
      {sharing ? <span className="spinner" style={{width:16,height:16}} /> : (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M14 3a1 1 0 0 0 0 2h3.59l-9.3 9.3a1 1 0 1 0 1.42 1.4l9.29-9.29V10a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-6z" />
          <path d="M5 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 1 0-2 0v5H5V7h5a1 1 0 1 0 0-2H5z" />
        </svg>
      )}
    </button>
  );

  if (exhibitionResult) {
    return <ExhibitionResultModal result={exhibitionResult} onClose={onClose} />;
  }

  return (
    <Modal open onClose={onClose} title={localizedName} className="item-detail-modal" headerLeftActions={shareHeaderBtn}>
      {toast && (
        <div className={`idm-toast ${toast.type==='err'?'idm-toast--err':''}`}>
          {toast.type==='err'
            ? <X size={13} style={{verticalAlign:'middle',marginRight:4}} />
            : <Check size={13} style={{verticalAlign:'middle',marginRight:4}} />}
          {toast.msg}
        </div>
      )}

      <div ref={cardContentRef} className="idm-capture-area" style={{padding: '8px 12px'}}>
      <div className="idm-header" style={{'--rarity-color':rc.color}}>
        <span className="idm-type-icon"><ItemTypeIcon type={item.find_type} size={32} /></span>
        <div className="idm-meta">
          <span className="idm-type-label">{TYPE_LABELS[item.find_type]||item.find_type}</span>
          <span className="idm-rarity" style={{color:rc.color}}>
            <RarityDot color={rc.color} size={9} style={{marginRight:5,verticalAlign:'middle'}} />{rc.label}
          </span>
        </div>
        {item.find_type==='asteroid' && !od.scanned && (
          <button
            className={`remote-scan-btn ${canRemoteScan?'':'remote-scan-btn--empty'}`}
            onClick={canRemoteScan?handleRemoteScan:undefined}
            disabled={scanning||!canRemoteScan}
            title={canRemoteScan?t('inventory.scan'):t('inventory.noScanners')}
          >
            {scanning?<span className="spinner" style={{width:14,height:14}}/>:<Satellite size={16} />}
            <span className="remote-scan-count">{scannerCount}</span>
          </button>
        )}
        {(canExhibit || isThisOnExhibition) && (() => {
          if (isThisOnExhibition && exhibitionReady) {
            return (
              <button
                className="exhibition-btn exhibition-btn--ready"
                onClick={handleExhibit}
                disabled={exhibiting}
                title={t('exhibition.collectFrom')}
              >
                {exhibiting ? <span className="spinner" style={{width:14,height:14}}/> : <ExhibitionIcon size={16} />}
              </button>
            );
          }
          if (isThisOnExhibition) {
            return (
              <button className="exhibition-btn exhibition-btn--active exhibition-btn--timer" disabled title={t('exhibition.onExhibition')}>
                <ExhibitionIcon size={14} />
                <span className="exh-btn-time">{exhTimeLeft != null ? fmtCountdown(exhTimeLeft) : '…'}</span>
              </button>
            );
          }
          return (
            <button
              className={`exhibition-btn${(exhibitionActive && !isThisOnExhibition) ? ' exhibition-btn--blocked' : ''}`}
              onClick={handleExhibit}
              disabled={exhibiting || (exhibitionActive && !isThisOnExhibition)}
              title={
                exhibitionActive && !isThisOnExhibition
                  ? t('exhibition.alreadyActive')
                  : t('exhibition.sendTo')
              }
            >
              {exhibiting ? <span className="spinner" style={{width:14,height:14}}/> : <ExhibitionIcon size={16} />}
            </button>
          );
        })()}
      </div>

      <div className="idm-rows">
        <TypeDetails findType={item.find_type} od={od}/>
        {item.find_type !== 'nft_container' && (
          <Row label={t('inventory.sellPrice')} value={<><SaleIcon size={12} style={{verticalAlign:'middle',marginRight:3}} />{sellPrice.toLocaleString()}</>}/>
        )}
        {item.viewer_sympathy != null && (
          <Row label={t('exhibition.viewerSympathy')} value={`${item.viewer_sympathy}%`}/>
        )}
        <Row label={t('inventory.acquired')} value={new Date(item.acquired_at).toLocaleDateString(isRu()?'ru-RU':'en-US')}/>
      </div>

      </div>{/* end idm-capture-area */}
      <div className="idm-actions">
        {item.find_type !== 'nft_container' && (
          <button className="btn btn-sell" onClick={handleSell} disabled={loading || isThisOnExhibition}>
            {loading ? <span className="spinner"/> : <><SaleIcon size={14} style={{verticalAlign:'middle',marginRight:5}} />{sellLabel}</>}
          </button>
        )}
        <button className="btn btn-secondary" onClick={onClose}>{t('common.close')}</button>
      </div>
    </Modal>
  );
}
