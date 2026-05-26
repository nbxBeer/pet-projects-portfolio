import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTelegram } from '../../hooks/useTelegram';
import ZoneSelector from '../ui/ZoneSelector';
import ExpeditionTimer from '../ui/ExpeditionTimer';
import FindResultCard from '../ui/FindResultCard';
import { ActionButtons } from '../ui/FindResultCard';
import { SpeedUpButton } from '../ui/StarsWallet';
import PirateEncounterCard from '../ui/PirateEncounterCard';
import QuestsView from '../ui/QuestsView';
import Modal from '../ui/Modal';
import UniverseModal from '../ui/UniverseModal';
import BlitzExpeditionModal from '../ui/BlitzExpeditionModal';
import { t } from '../../i18n';
import EventBanner from '../ui/EventBanner';
import TournamentBanner from '../ui/TournamentBanner';
import NewsBanner from '../ui/NewsBanner';
import GalaxyCanvas from '../ui/GalaxyCanvas';
import { localizeZoneName } from '../../i18n/entities';
import { ClipboardList, CoinIcon, CrystalIcon, Dna, Atom, Skull, UfoIcon, Package, Rocket, X, Check, Star, Zap } from '../../icons';

const LONG_EXP_KEY = 'starloot_long_expedition';

// ── Memoized sub-components to prevent cascade re-renders ─────────────────

const HudRow = memo(function HudRow({ onOpenQuests }) {
  return (
    <div className="panel-hud-row">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <EventBanner />
        <TournamentBanner />
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button className="lb-open-btn" onClick={onOpenQuests} title={t('expedition.quests')}>
          <ClipboardList size={18} />
        </button>
        <NewsBanner />
      </div>
    </div>
  );
});

const GalaxySection = memo(function GalaxySection({ onOpenUniverse, currentUniverse }) {
  const isU2 = currentUniverse === 2;
  return (
    <button
      type="button"
      className="galaxy-illustration galaxy-illustration-btn"
      onClick={onOpenUniverse}
      title={t('universe.title')}
      aria-label={t('universe.title')}
    >
      <span className="galaxy-scan-grid" aria-hidden="true" />
      <span className="galaxy-scan-line" aria-hidden="true" />
      <GalaxyCanvas size={160} universe={currentUniverse} />
      <span className={`universe-badge galaxy-universe-badge ${isU2 ? 'u2' : 'u1'}`}>
        {isU2 ? 'II' : 'I'}
      </span>
      <span className="galaxy-panel-title">{t('universe.title')}</span>
      <span className="galaxy-panel-sub">{isU2 ? t('universe.currentU2') : t('universe.currentU1')}</span>
      <span className="galaxy-panel-action">↔ {t('universe.travelTo')}</span>
    </button>
  );
});

const ZonePickerRow = memo(function ZonePickerRow({ zoneName, zoneId, zone, glowClass, onClick }) {
  const mods = zone?.findTypeModifiers || {};
  const significantMods = Object.entries(mods).filter(([, v]) => v !== 1.0);
  return (
    <div className={`zone-picker-row ${glowClass}`} onClick={onClick}>
      <div className="zone-picker-info">
        <div className="zone-picker-label">{t('expedition.selectedZone') || 'Selected Zone'}</div>
        <div className={`zone-picker-value ${zoneId ? `zone-name-${zoneId}` : ''}`}>
          {zoneName || t('expedition.selectZone')}
        </div>
        <div className="zone-picker-mults">
          {zone && <span className="mult-chip"><CoinIcon size={11} style={{verticalAlign:'middle',marginRight:2}} />×{zone.creditMultiplier}</span>}
          {zone && <span className="mult-chip"><Dna size={11} style={{verticalAlign:'middle',marginRight:2}} />×{zone.xpMultiplier}</span>}
          {significantMods.slice(0, 2).map(([type, mult]) => (
            <span key={type} className="mult-chip">{type} ×{mult}</span>
          ))}
        </div>
      </div>
      <span className="zone-picker-arrow">›</span>
    </div>
  );
});

// ── Circular progress ring timer for in-progress state ─────────────────────
function FlightProgressHero({ expedition, expeditionZoneName, onExpired, speedUpCost }) {
  const [remaining, setRemaining] = useState(0);
  const initialRef = useRef(null);
  const firedRef = useRef(false);

  useEffect(() => {
    initialRef.current = null;
    firedRef.current = false;
    const calc = () => {
      const diff = Math.max(0, new Date(expedition.endsAt) - Date.now());
      if (initialRef.current === null) initialRef.current = diff || 1;
      setRemaining(diff);
      if (diff === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpired?.();
      }
    };
    calc();
    const timer = setInterval(calc, 1000);
    return () => clearInterval(timer);
  }, [expedition.endsAt]);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  const total = initialRef.current || remaining || 1;
  const progress = remaining / total;
  const R = 45;
  const CIRC = 2 * Math.PI * R;
  const arc = progress * CIRC;

  return (
    <div className="flight-hero">
      <div className="progress-ring-wrap">
        <svg className="progress-ring-svg" viewBox="0 0 100 100">
          <circle className="progress-ring-bg" cx="50" cy="50" r={R} />
          <circle
            className="progress-ring-arc"
            cx="50" cy="50" r={R}
            style={{ strokeDasharray: `${arc} ${CIRC}` }}
          />
        </svg>
        <div className="progress-ring-inner">
          <div className="progress-time">
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </div>
          <div className="progress-sub">remaining</div>
        </div>
      </div>
      <div className="flight-hero-label">{t('expedition.inProgress')}</div>
      <div className="flight-hero-meta">
        {expeditionZoneName}{expedition.sector ? ` · ${expedition.sector}` : ''}{expedition.isLongExpedition ? ' · Long' : ''}
      </div>
      <SpeedUpButton expeditionId={expedition.expeditionId || expedition.id} costStars={speedUpCost} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ExpeditionPanel() {
  // Granular selectors — pull only primitives/small values where possible
  const expedition = useGameStore((s) => s.expedition);
  const expeditionResult = useGameStore((s) => s.expeditionResult);
  const pirateEncounter = useGameStore((s) => s.pirateEncounter);
  const expeditionCooldownUntil = useGameStore((s) => s.expeditionCooldownUntil);
  const zones = useGameStore((s) => s.zones);
  const selectedZoneId = useGameStore((s) => s.selectedZoneId);
  const setSelectedZoneId = useGameStore((s) => s.setSelectedZoneId);
  const loadingExpedition = useGameStore((s) => s.loading.expedition);
  const startExpedition = useGameStore((s) => s.startExpedition);
  const collectExpedition = useGameStore((s) => s.collectExpedition);
  const takeAction = useGameStore((s) => s.takeAction);
  const clearExpeditionResult = useGameStore((s) => s.clearExpeditionResult);
  const markExpeditionReady = useGameStore((s) => s.markExpeditionReady);
  const universeTravelUntil = useGameStore((s) => s.user?.universeTravelUntil ?? null);
  const loadProfile = useGameStore((s) => s.loadProfile);

  // Only pull the specific fields we need from user/customization (not entire objects)
  const zoneGlow = useGameStore((s) => s.customization?.zoneGlow ?? s.user?.zoneGlow ?? null);

  const { haptic, showAlert } = useTelegram();

  const [showZoneSelector, setShowZoneSelector] = useState(false);
  const [showQuests, setShowLeaderboard] = useState(false);
  const [showUniverse, setShowUniverse] = useState(false);
  const [showBlitz, setShowBlitz] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionToast, setActionToast] = useState(null);
  const currentUniverse = useGameStore((s) => s.user?.currentUniverse || 1);
  const [longExpedition, setLongExpedition] = useState(() => {
    try { return localStorage.getItem(LONG_EXP_KEY) === '1'; }
    catch { return false; }
  });
  const hasDecelerator = useGameStore((s) => s.user?.hasParticleDecelerator ?? false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const effectiveLongExpedition = hasDecelerator && longExpedition;
  const isUniverseTraveling = Boolean(universeTravelUntil) && (new Date(universeTravelUntil) > new Date());

  const showToast = useCallback((msg, type='ok') => {
    setActionToast({msg,type});
    setTimeout(() => setActionToast(null), 1200);
  }, []);

  useEffect(() => {
    if (!expeditionCooldownUntil) { setCooldownRemaining(0); return; }
    const update = () => {
      const diff = Math.max(0, new Date(expeditionCooldownUntil) - Date.now());
      setCooldownRemaining(diff);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [expeditionCooldownUntil]);

  // Memoize zone lookup — avoid double .find() every render
  const selectedZone = useMemo(() =>
    zones.find((z) => z.id === selectedZoneId && !z.locked)
    || zones.find((z) => !z.locked)
    || null,
    [zones, selectedZoneId]
  );

  useEffect(() => {
    if (!selectedZoneId && zones.length) {
      const first = zones.find((z) => !z.locked);
      if (first) setSelectedZoneId(first.id);
    }
  }, [zones]);

  useEffect(() => {
    if (!expeditionResult) setActionLoading(null);
  }, [expeditionResult]);

  useEffect(() => {
    try { localStorage.setItem(LONG_EXP_KEY, longExpedition ? '1' : '0'); }
    catch {}
  }, [longExpedition]);

  const handleStartExpedition = useCallback(async () => {
    if (!selectedZone) return;
    haptic.impact('medium');
    try {
      await startExpedition(selectedZone.id, effectiveLongExpedition);
      haptic.notification('success');
    } catch (err) {
      haptic.notification('error');
      await showAlert(err.message || t('common.error'));
    }
  }, [selectedZone?.id, effectiveLongExpedition]);

  const handleCollect = useCallback(async () => {
    haptic.impact('light');
    try {
      await collectExpedition(expedition?.expeditionId || expedition?.id);
    } catch (err) {
      if (err.status === 425 || err.message?.includes('425')) return;
      await showAlert(err.message);
    }
  }, [expedition?.expeditionId, expedition?.id]);

  const handleAction = useCallback(async (action) => {
    if (!expeditionResult?.resultId || actionLoading) return;
    setActionLoading(action);
    haptic.impact('medium');
    try {
      const res = await takeAction(expeditionResult.resultId, action);
      haptic.notification('success');
      const starBonus = res?.starBonus
        ? <> · +{res.starBonus} <Star size={12} style={{verticalAlign:'middle'}} /></>
        : null;
      if (action === 'sell' && res?.saleCurrency === 'crystals' && res?.crystalsGained) {
        showToast(<span><CrystalIcon size={12} style={{verticalAlign:'middle',marginRight:3}} />+{res.crystalsGained.toLocaleString()}{' · '}<Dna size={12} style={{verticalAlign:'middle',marginRight:2}} />+{res.xpGained} XP{starBonus}</span>);
      } else if (action === 'sell' && res?.creditsGained) {
        showToast(<span><CoinIcon size={12} style={{verticalAlign:'middle',marginRight:3}} />+{res.creditsGained.toLocaleString()}{' · '}<Dna size={12} style={{verticalAlign:'middle',marginRight:2}} />+{res.xpGained} XP{starBonus}</span>);
      } else if (action === 'save_coords') {
        showToast(<span>{t('expedition.coordsSaved', { bonus: '' })}{starBonus}</span>);
      } else if (res?.xpGained) {
        showToast(<span><Dna size={12} style={{verticalAlign:'middle',marginRight:2}} />+{res.xpGained} XP{starBonus}</span>);
      }
    } catch (err) {
      haptic.notification('error');
      await showAlert(err.message || t('common.error'));
    } finally {
      setActionLoading(null);
    }
  }, [expeditionResult?.resultId, actionLoading, showToast]);

  const handleDismiss = useCallback(() => {
    haptic.impact('light');
    clearExpeditionResult();
  }, []);

  const handleSell = useCallback(() => handleAction('sell'), [handleAction]);
  const handleCollectAction = useCallback(() => handleAction('collect'), [handleAction]);

  const handleZoneSelect = useCallback((z) => {
    setSelectedZoneId(z.id);
    setShowZoneSelector(false);
  }, []);

  const closeZoneSelector = useCallback(() => setShowZoneSelector(false), []);
  const closeQuests = useCallback(() => setShowLeaderboard(false), []);
  const openQuests = useCallback(() => setShowLeaderboard(true), []);
  const openZoneSelector = useCallback(() => setShowZoneSelector(true), []);
  const openUniverse = useCallback(() => setShowUniverse(true), []);
  const closeUniverse = useCallback(() => setShowUniverse(false), []);
  const openBlitz = useCallback(() => setShowBlitz(true), []);
  const closeBlitz = useCallback(() => setShowBlitz(false), []);

  // ── Precomputed values ──────────────────────────────────────────────────────
  const glowClass = zoneGlow === 'supporter' ? 'zone-row--supporter'
    : zoneGlow === 'captain' ? 'zone-row--captain' : '';

  // Memoize zone name for in-progress view
  const expeditionZoneName = useMemo(() => {
    if (!expedition?.zoneId) return '';
    const z = zones.find((zone) => zone.id === expedition.zoneId);
    return localizeZoneName(z) || expedition.zoneId;
  }, [expedition?.zoneId, zones]);

  // ── Global toast overlay (renders above all states) ───────────────────────
  const toastOverlay = actionToast && (
    <div className="expedition-toast-overlay">
      <div className={`idm-toast${actionToast.type === 'err' ? ' idm-toast--err' : ''}`}>
        {actionToast.type === 'err'
        ? <X size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
        : <Check size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
      }{actionToast.msg}
      </div>
    </div>
  );

  // ── Pirate encounter modal ────────────────────────────────────────────────
  if (pirateEncounter) {
    return (
      <div className="expedition-panel">
        {toastOverlay}
        <PirateEncounterCard encounter={pirateEncounter} onResolved={() => {}} />
      </div>
    );
  }

  // ── Result card ───────────────────────────────────────────────────────────
  if (expeditionResult) {
    const isAutoComplete = expeditionResult.outcome === 'cargo_full' || expeditionResult.outcome === 'no_capsule';

    return (
      <div className="expedition-panel">
        {toastOverlay}
        <div className="anim-fadein-scale">
          <h2 className="section-title">
            {expeditionResult.pirateOutcome === 'fight_win' ? t('expedition.pirateWin') : t('expedition.findResult')}
          </h2>
          <FindResultCard result={expeditionResult} />
          {isAutoComplete ? (
            <ActionButtons
              result={expeditionResult}
              onDismiss={handleDismiss}
              loadingAction={null}
            />
          ) : (
            <ActionButtons
              result={expeditionResult}
              onSell={handleSell}
              onAction={handleAction}
              onDismiss={handleCollectAction}
              loadingAction={actionLoading}
            />
          )}
        </div>
      </div>
    );
  }

  // ── No expedition ─────────────────────────────────────────────────────────
  if (!expedition) {
    if (isUniverseTraveling) {
      return (
        <div className="expedition-panel">
          {toastOverlay}
          <HudRow onOpenQuests={openQuests} />
          <div className="in-progress-scene">
            <div className="ship-animation">
              <span className="ship-emoji"><UfoIcon size={48} /></span>
              <div className="warp-lines" />
            </div>

            <h2 className="section-title">{t('expedition.inProgress')}</h2>

            <div className="expedition-info">
              <div className="info-row">
                <span>{t('expedition.zone')}</span>
                <span>{t('universe.title')}</span>
              </div>
              <div className="info-row">
                <span>{t('expedition.sector')}</span>
                <span>{t('universe.traveling')}</span>
              </div>
            </div>

            <ExpeditionTimer endsAt={universeTravelUntil} onExpired={loadProfile} />
          </div>

          {showQuests && (
            <Modal open onClose={closeQuests} title={t('expedition.quests')}>
              <QuestsView />
            </Modal>
          )}
          {showUniverse && <UniverseModal onClose={closeUniverse} />}
        </div>
      );
    }

    // Cooldown screen after pirate defeat
    if (cooldownRemaining > 0) {
      const mins = Math.floor(cooldownRemaining / 60000);
      const secs = Math.floor((cooldownRemaining % 60000) / 1000);
      return (
        <div className="expedition-panel">
          {toastOverlay}
          <div className="ready-scene">
            <div className="ready-icon"><Skull size={48} /></div>
            <h2 className="section-title">{t('expedition.shipDamaged')}</h2>
            <p className="hint-text">{t('expedition.shipDamagedDesc')}</p>
            <div className="cooldown-timer">
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </div>
            <p className="hint-text" style={{ marginTop: 16 }}>
              {t('expedition.buyCloakTip')}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="expedition-panel">
        {toastOverlay}
        <HudRow onOpenQuests={openQuests} />

        <div className="space-scene">
          <GalaxySection onOpenUniverse={openUniverse} currentUniverse={currentUniverse} />

          <ZonePickerRow
            zoneName={localizeZoneName(selectedZone)}
            zoneId={selectedZone?.id}
            zone={selectedZone}
            glowClass={glowClass}
            onClick={openZoneSelector}
          />

          <div className="launch-card">
            <div className="launch-row">
              <button
                className="btn btn-primary btn-launch"
                onClick={handleStartExpedition}
                disabled={loadingExpedition || !selectedZone}
              >
                {loadingExpedition ? <span className="spinner" /> : (
                effectiveLongExpedition
                  ? <><Atom size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />{t('expedition.launchLong')}</>
                  : <><Rocket size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />{t('expedition.launch')}</>
              )}
              </button>
              {hasDecelerator && (
                <button
                  className={`btn-long-toggle ${effectiveLongExpedition ? 'btn-long-active' : ''}`}
                  onClick={() => { setLongExpedition(v => !v); haptic.impact('light'); }}
                  title={t('expedition.longExpeditionToggle')}
                >
                  <Atom size={18} />
                </button>
              )}
            </div>
            <p className="hint-text">{effectiveLongExpedition ? t('expedition.longTime') : t('expedition.baseTime')}</p>

            {/* Blitz raid button */}
            <button
              className="btn btn-secondary"
              onClick={openBlitz}
              style={{ marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Zap size={14} />
              {t('blitz.title')}
            </button>
          </div>
        </div>

        {showZoneSelector && (
          <ZoneSelector
            zones={zones}
            selected={selectedZone}
            onSelect={handleZoneSelect}
            onClose={closeZoneSelector}
          />
        )}
        {showQuests && (
          <Modal open onClose={closeQuests} title={t('expedition.quests')}>
            <QuestsView />
          </Modal>
        )}
        {showUniverse && <UniverseModal onClose={closeUniverse} />}
        {showBlitz && <BlitzExpeditionModal onClose={closeBlitz} />}
      </div>
    );
  }

  // ── In progress ───────────────────────────────────────────────────────────
  if (expedition.status === 'in_progress') {
    return (
      <div className="expedition-panel">
        {toastOverlay}
        <HudRow onOpenQuests={openQuests} />
        <div className="in-progress-scene" style={{ alignItems: 'stretch' }}>
          <FlightProgressHero
            expedition={expedition}
            expeditionZoneName={expeditionZoneName}
            onExpired={markExpeditionReady}
            speedUpCost={expedition.isLongExpedition ? 20 : 1}
          />
          {expedition.isLongExpedition && (
            <div className="long-expedition-badge"><Atom size={13} style={{verticalAlign:'middle',marginRight:4}} />{t('expedition.longLabel')}</div>
          )}
        </div>
        {showQuests && (
          <Modal open onClose={closeQuests} title={t('expedition.quests')}>
            <QuestsView />
          </Modal>
        )}
        {showUniverse && <UniverseModal onClose={closeUniverse} />}
      </div>
    );
  }

  // ── Completed — awaiting collect ──────────────────────────────────────────
  return (
    <div className="expedition-panel">
      {toastOverlay}
      <HudRow onOpenQuests={openQuests} />
      <div className="ready-scene">
        <div className="ready-icon"><Package size={48} /></div>
        <h2 className="section-title">{t('expedition.shipReturned')}</h2>
        <p className="hint-text" style={{ marginBottom: 24 }}>{t('expedition.shipReturnedDesc')}</p>
        <button
          className="btn btn-primary btn-pulse"
          onClick={handleCollect}
          disabled={loadingExpedition}
        >
          {loadingExpedition ? <span className="spinner" /> : t('expedition.openFind')}
        </button>
      </div>
      {showQuests && (
        <Modal open onClose={closeQuests} title={t('expedition.quests')}>
          <QuestsView />
        </Modal>
      )}
    </div>
  );
}
