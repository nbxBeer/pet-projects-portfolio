import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../../store/gameStore';
import { HEADER_COLORS, NAME_DECORS as DECORS_CATALOG, AVATARS as AVATARS_CATALOG, DECOR_EFFECT_COLORS, applyDecor } from './customizationCatalog';
import { customizationApi } from '../../services/api';
import { t, getLang, setLang } from '../../i18n';
import { localizeAchievement, localizeItemName, localizeStatsObjectName, localizeZoneName } from '../../i18n/entities';
import { useAndroidWebView } from '../../utils/platform';
import Modal from './Modal';
import ReferralView from './ReferralView';
import LeaderboardModal from './LeaderboardModal';
import PrestigeView from './PrestigeView';
import {
  CoinIcon, Star, CrystalIcon, Dna, Rocket, Package, Pickaxe, ShoppingCart,
  ItemTypeIcon, UfoIcon, Sparkles, Gift, GalaxyIcon,
  Trophy, BarChart2, Palette, Users, Lock, X,
} from '../../icons';

// ─── ExpeditionTimer ──────────────────────────────────────────────────────────
export default function ExpeditionTimer({ endsAt, onExpired }) {
  const [remaining, setRemaining] = useState(0);
  const [expired, setExpired] = useState(false);
  // useRef prevents stale-closure double-fire: if setInterval calls calc()
  // again before React re-renders with the new expired=true state, the ref
  // check guarantees onExpired fires exactly once per endsAt value.
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setExpired(false);
    const calc = () => {
      const diff = Math.max(0, new Date(endsAt) - new Date());
      setRemaining(diff);
      if (diff === 0 && !firedRef.current) {
        firedRef.current = true;
        setExpired(true);
        onExpired?.();
      }
    };
    calc();
    const timer = setInterval(calc, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const progress = endsAt
    ? 1 - remaining / (new Date(endsAt) - new Date(endsAt) + remaining || 1)
    : 0;

  if (expired) {
    return (
      <div className="timer ready anim-fadein-scale">
        {t('expedition.finished')}
      </div>
    );
  }

  return (
    <div className="timer">
      <div className="timer-display">
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </div>
      <div className="timer-label">{t('expedition.untilReturn')}</div>
    </div>
  );
}


// Helper: get glow CSS class for active decor effect
function getDecorClass(decorId) {
  if (!decorId) return '';
  const d = DECORS_CATALOG.find((x) => x.id === decorId);
  return d?.effect ? `decor-fx-${d.effect}` : '';
}
// ─── UserHeader ───────────────────────────────────────────────────────────────
export const UserHeader = memo(function UserHeader() {
  const user = useGameStore((s) => s.user);
  const [cardOpen, setCardOpen] = useState(false);

  // Memoize derived values to avoid recalculation on unrelated user changes
  const { xpProgress, hc, xpCurrent, xpNeeded } = useMemo(() => {
    if (!user) return { xpProgress: 0, hc: HEADER_COLORS[0], xpCurrent: 0, xpNeeded: 0 };
    const _xpCurrent = user.xp - (user.xpForCurrentLevel || 0);
    const _xpNeeded = user.xpForNextLevel ? user.xpForNextLevel - (user.xpForCurrentLevel || 0) : 0;
    return {
      xpCurrent: _xpCurrent,
      xpNeeded: _xpNeeded,
      xpProgress: _xpNeeded > 0 ? Math.min(100, (_xpCurrent / _xpNeeded) * 100) : 100,
      hc: HEADER_COLORS.find((c) => c.id === (user.headerColor || 'blue')) || HEADER_COLORS[0],
    };
  }, [user?.xp, user?.xpForCurrentLevel, user?.xpForNextLevel, user?.headerColor]);

  // Must be before early return — Rules of Hooks
  useEffect(() => {
    document.documentElement.style.setProperty('--theme-accent', hc.accent);
    document.documentElement.style.setProperty('--theme-color', hc.color);
  }, [hc.accent, hc.color]);

  const openCard = useCallback(() => setCardOpen(true), []);
  const closeCard = useCallback(() => setCardOpen(false), []);

  // Memoize header style to avoid new object on every render
  const headerStyle = useMemo(() => ({
    cursor: 'pointer',
    background: `linear-gradient(160deg, #040410 0%, ${hc.color} 100%)`,
    boxShadow: `0 1px 0 ${hc.accent}18, 0 4px 20px rgba(0,0,0,0.5)`,
    borderBottom: 'none',
  }), [hc.color, hc.accent]);

  // Memoize decor lookups so they don't run on every render
  const { decorClass, nameStyle } = useMemo(() => {
    const decorClass = getDecorClass(user?.activeDecorId);
    const hasEffect = user?.activeDecorId && DECORS_CATALOG.find((d) => d.id === user.activeDecorId)?.effect;
    return {
      decorClass,
      nameStyle: hasEffect ? undefined : { color: hc.accent },
    };
  }, [user?.activeDecorId, hc.accent]);

  if (!user) return <div className="user-header skeleton" />;

  return (
    <>
      <div
        className="user-header"
        onClick={openCard}
        style={headerStyle}
      >
        <div className="header-top">
          <div className="header-left">
            <div className="user-name-row">
              <span
                className={`user-name ${decorClass}`}
                style={nameStyle}
              >{applyDecor(user.firstName || user.username || t('profile.pilot'), user.activeDecorId)}</span>
              {user.selectedAchievement && (
                <span className="user-achievement-badge" title={localizeAchievement(user.selectedAchievement).name}>
                  {user.selectedAchievement.icon || '🏆'}
                </span>
              )}
            </div>
            <span className="user-level-label">Level {user.level}</span>
            <span className="user-level-label">
              {xpNeeded > 0
                ? `XP ${xpCurrent.toLocaleString()} / ${xpNeeded.toLocaleString()}`
                : 'MAX'}
            </span>
          </div>
          <div className="user-balances">
            <span className="credits"><CoinIcon size={13} style={{verticalAlign:'middle',marginRight:3}} />{Number(user.credits).toLocaleString()}</span>
            <span className="stars-display"><Star size={13} style={{verticalAlign:'middle',marginRight:3}} />{user.starsBalance ?? 0}</span>
            {user.hasVisitedUniverse2 && (
              <span className="crystals-display"><CrystalIcon size={13} style={{verticalAlign:'middle',marginRight:3}} />{Number(user.crystals || 0).toLocaleString()}</span>
            )}
          </div>
        </div>
        {/* Full-width XP strip — no text, no padding */}
        <div className="xp-strip">
          <div className="xp-strip-fill" style={{ width: `${xpProgress}%` }} />
        </div>
      </div>
      {cardOpen && <PlayerCardModal user={user} onClose={closeCard} />}
    </>
  );
});

// ─── BottomNav ────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'expedition', labelKey: 'nav.expedition', Icon: Rocket         },
  { id: 'collection', labelKey: 'nav.collection', Icon: Package        },
  { id: 'drills',     labelKey: 'nav.drills',     Icon: Pickaxe, minLevel: 10 },
  { id: 'upgrades',   labelKey: 'nav.shop',        Icon: ShoppingCart  },
];

export const BottomNav = memo(function BottomNav() {
  const activeTab = useGameStore((s) => s.activeTab);
  const setActiveTab = useGameStore((s) => s.setActiveTab);
  const userLevel = useGameStore((s) => s.user?.level ?? 1);

  return (
    <nav className="bottom-nav">
      {TABS.filter((tab) => !tab.minLevel || userLevel >= tab.minLevel).map((tab) => (
        <button
          key={tab.id}
          className={`nav-btn ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span className="nav-icon">{tab.Icon && <tab.Icon size={22} />}</span>
          <span className="nav-label">{t(tab.labelKey)}</span>
          {activeTab === tab.id && (
            <div className="nav-indicator" />
          )}
        </button>
      ))}
    </nav>
  );
});

// ─── Zone type icons for modifiers ───────────────────────────────────────────
// Replaced with ItemTypeIcon component below

// ─── useSwipeDown — tiny hook: swipe down on an element to call onClose ─────
function useSwipeDown(onClose) {
  const ref = useRef(null);
  const startY = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const down = (e) => { startY.current = (e.touches?.[0] ?? e).clientY; };
    const up   = (e) => {
      const dy = (e.changedTouches?.[0] ?? e).clientY - startY.current;
      if (dy > 60) onClose();
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchend',   up,   { passive: true });
    // also handle mouse drag for desktop testing
    el.addEventListener('mousedown',  down);
    el.addEventListener('mouseup',    up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchend',   up);
      el.removeEventListener('mousedown',  down);
      el.removeEventListener('mouseup',    up);
    };
  }, [onClose]);
  return ref;
}

// ─── BottomSheet — pure CSS bottom sheet, no Framer drag, no lag ─────────────
// Uses CSS classes for open/close animation. Renders into a portal.
function BottomSheet({ open, onClose, children, className = '' }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const sheetRef = useSwipeDown(onClose);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Small delay so CSS transition fires after mount
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 280);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`bs-overlay ${visible ? 'bs-overlay--in' : ''}`}
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        className={`bs-sheet ${visible ? 'bs-sheet--in' : ''} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bs-handle-zone">
          <div className="bs-handle-pill" />
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

// ─── ZoneSelector ────────────────────────────────────────────────────────────
export function ZoneSelector({ zones, selected, onSelect, onClose }) {
  const el = (
    <Modal open onClose={onClose} title={t('expedition.zoneSelection')}>
        <div className="zones-list">
          {zones.map((zone) => {
            const mods = zone.findTypeModifiers || {};
            const significantMods = Object.entries(mods).filter(([, v]) => v !== 1.0);
            return (
              <button
                key={zone.id}
                className={`zone-item ${!zone.locked && selected?.id === zone.id ? 'selected' : ''} ${zone.locked ? 'locked' : ''}`}
                onClick={zone.locked ? undefined : () => onSelect(zone)}
                disabled={zone.locked}
              >
                <div className="zone-item-info">
                  <span className={`zone-item-name ${zone.locked ? '' : `zone-name-${zone.id}`}`}>
                    {localizeZoneName(zone)}
                    {zone.universe === 2 && !zone.locked && (
                      <span className="universe-badge u2" style={{ marginLeft: 6 }}>II</span>
                    )}
                  </span>
                  {!zone.locked && significantMods.length > 0 && (
                    <div className="zone-modifiers">
                      {significantMods.map(([type, mult]) => (
                        <span key={type} className="zone-modifier-chip">
                          <ItemTypeIcon type={type} size={12} style={{verticalAlign:'middle',marginRight:2}} />×{mult}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {zone.locked ? (
                  <div className="zone-lock-overlay">
                    <Lock size={16} />
                    <span>{t('expedition.zoneLocked', { level: zone.minLevel })}</span>
                  </div>
                ) : (
                  <div className="zone-item-stats">
                    <span><CoinIcon size={11} style={{verticalAlign:'middle',marginRight:2}} />×{zone.creditMultiplier}</span>
                    <span><Dna size={11} style={{verticalAlign:'middle',marginRight:2}} />×{zone.xpMultiplier}</span>
                  </div>
                )}
                {!zone.locked && selected?.id === zone.id && <span className="check">✓</span>}
              </button>
            );
          })}
        </div>
    </Modal>
  );
  return el;
}

// ─── InventoryItem ────────────────────────────────────────────────────────────
const RARITY_COLORS = {
  common: '#9e9e9e', rare: '#2196f3',
  epic: '#9c27b0', legendary: '#ffc107', mythical: '#f44336',
  // U2
  exotic: '#26c6da', ancient: '#8d6e63', relic: '#ff7043',
  hybrid: '#ab47bc', singularity: '#e040fb',
};
// Replaced with ItemTypeIcon component

export const InventoryItem = memo(function InventoryItem({ item }) {
  const color = RARITY_COLORS[item.rarity] || '#9e9e9e';
  const itemName = localizeItemName({
    objectData: item.object_data,
    templateId: item.template_id,
    fallback: 'Object',
  });

  const exhibitionStatus = useGameStore((s) => s.exhibitionStatus);
  const exhibitionReady = exhibitionStatus?.isReady && exhibitionStatus?.inventoryItemId === item.id;

  return (
    <div
      className={`inventory-item${exhibitionReady ? ' inventory-item--exh-ready' : ''}`}
      style={{ '--item-color': color, '--exh-glow': color }}
    >
      <div className="item-rarity-strip" />
      <div className="item-icon"><ItemTypeIcon type={item.find_type} size={28} /></div>
      <div className="item-info">
        <span className="item-name">{itemName}</span>
        <span className="item-rarity-badge">{t(`rarity.${item.rarity}`)}</span>
      </div>
    </div>
  );
});

// ─── LoadingScreen ────────────────────────────────────────────────────────────
export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-ship loading-ship-spin"><UfoIcon size={64} /></div>
      <p className="loading-text">{t('common.loading')}</p>
    </div>
  );
}

// ─── ErrorToast ───────────────────────────────────────────────────────────────
export function ErrorToast() {
  const error = useGameStore((s) => s.error);
  const clearError = useGameStore((s) => s.clearError);

  useEffect(() => {
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <div className="error-toast anim-slide-up">
      ⚠️ {error}
    </div>
  );
}

// ─── PlayerCardModal ─────────────────────────────────────────────────────────
const CARD_VIEWS = {
  main:    'main',
  stats:   'stats',
  premium: 'premium',
  custom:  'custom',
  achievements: 'achievements',
  referral: 'referral',
  miniTournament: 'miniTournament',
  leaderboard: 'leaderboard',
  prestige: 'prestige',
};

function AndroidPlayerModalShell({ title, onClose, backLabel, onBack, headerActions, children }) {
  useEffect(() => {
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
  }, []);

  return createPortal(
    <div className="android-player-overlay" onClick={onClose}>
      <section className="android-player-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="android-player-header">
          <div className="android-player-header-side">
            {onBack && (
              <button className="android-player-back" onClick={onBack}>
                {backLabel || t('common.back')}
              </button>
            )}
          </div>
          <div className="android-player-title">{title}</div>
          <div className="android-player-header-side android-player-header-side--right">
            {headerActions}
            <button className="android-player-close" onClick={onClose} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="android-player-content">
          {children}
        </div>
      </section>
    </div>,
    document.body
  );
}

const PlayerCardModal = memo(function PlayerCardModal({ user, onClose }) {
  const androidWebView = useAndroidWebView();
  const [view, setView] = useState(CARD_VIEWS.main);
  const [achievements, setAchievements] = useState(null);
  const [miniTournament, setMiniTournament] = useState(null);
  const [refGuide, setRefGuide] = useState(false);
  const stats = useGameStore((s) => s.stats);
  const loadingStats = useGameStore((s) => s.loading.stats);
  const loadStats = useGameStore((s) => s.loadStats);
  const loadAchievements = useGameStore((s) => s.loadAchievements);
  const loadMiniTournament = useGameStore((s) => s.loadMiniTournament);
  const loadCustomization = useGameStore((s) => s.loadCustomization);

  const handleStatsRefresh = useCallback(() => loadStats(true), [loadStats]);

  const handleStats = useCallback(() => { setView(CARD_VIEWS.stats); loadStats(); }, [loadStats]);
  const handleCustom = useCallback(() => { setView(CARD_VIEWS.custom); loadCustomization(); }, [loadCustomization]);

  const handleAchievements = useCallback(async () => {
    setView(CARD_VIEWS.achievements);
    if (!achievements) {
      const list = await loadAchievements();
      setAchievements(list);
    }
  }, [achievements, loadAchievements]);

  const handleMiniTournament = useCallback(async () => {
    setView(CARD_VIEWS.miniTournament);
    const data = await loadMiniTournament();
    setMiniTournament(data);
  }, [loadMiniTournament]);

  const goBack = useCallback(() => { setView(CARD_VIEWS.main); setRefGuide(false); }, []);
  const toggleRefGuide = useCallback(() => setRefGuide((g) => !g), []);

  const viewTitles = useMemo(() => ({
    main: t('profile.profile'),
    stats: t('profile.stats'),
    achievements: t('profile.achievements'),
    custom: t('profile.customization'),
    premium: t('profile.premium'),
    referral: t('profile.referral'),
    miniTournament: t('profile.miniTournament'),
    leaderboard: t('profile.leaderboard'),
    prestige: t('profile.prestige'),
  }), []);

  const headerActions = view === CARD_VIEWS.referral ? (
    <button className="m-guide-btn" onClick={toggleRefGuide}>{refGuide ? '✕' : '?'}</button>
  ) : null;

  const handleNav = useCallback((v) => {
    if (v === CARD_VIEWS.stats) handleStats();
    else if (v === CARD_VIEWS.achievements) handleAchievements();
    else if (v === CARD_VIEWS.miniTournament) handleMiniTournament();
    else if (v === CARD_VIEWS.custom) handleCustom();
    else setView(v);
  }, [handleStats, handleAchievements, handleMiniTournament, handleCustom]);

  const children = (
    <>
      {view === CARD_VIEWS.main && (
        androidWebView
          ? <AndroidPlayerCardMain user={user} onNav={handleNav} />
          : <PlayerCardMain user={user} onNav={handleNav} />
      )}
      {view === CARD_VIEWS.stats && <PlayerStatsView stats={stats} loading={loadingStats} onRefresh={handleStatsRefresh} />}
      {view === CARD_VIEWS.premium && <PremiumView user={user} />}
      {view === CARD_VIEWS.custom && <CustomizationView user={user} />}
      {view === CARD_VIEWS.achievements && <PlayerAchievementsView achievements={achievements} user={user} />}
      {view === CARD_VIEWS.referral && <ReferralView showGuide={refGuide} />}
      {view === CARD_VIEWS.miniTournament && <MiniTournamentView data={miniTournament} />}
      {view === CARD_VIEWS.leaderboard && <LeaderboardModal embedded />}
      {view === CARD_VIEWS.prestige && <PrestigeView user={user} />}
    </>
  );

  if (androidWebView) {
    return (
      <AndroidPlayerModalShell
        title={viewTitles[view] || t('profile.profile')}
        onClose={onClose}
        backLabel={view !== CARD_VIEWS.main ? t('common.back') : undefined}
        onBack={view !== CARD_VIEWS.main ? goBack : undefined}
        headerActions={headerActions}
      >
        {children}
      </AndroidPlayerModalShell>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={viewTitles[view] || t('profile.profile')}
      backLabel={view !== CARD_VIEWS.main ? t('common.back') : undefined}
      onBack={view !== CARD_VIEWS.main ? goBack : undefined}
      headerActions={headerActions}
      className="player-card-modal player-card-sheet"
    >
      {children}
    </Modal>
  );
});

const PlayerCardMain = memo(function PlayerCardMain({ user, onNav }) {
  const customAvatarId = useGameStore((s) => s.customization?.avatarId);
  const customDecorId = useGameStore((s) => s.customization?.activeDecorId);
  const customHeaderColor = useGameStore((s) => s.customization?.headerColor);

  const { joinDate, hc, avatarCfg, activeDecorId, activeDecor, nameColor, themeStyle, avatarStyle, decorClass } = useMemo(() => {
    const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US';
    const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString(locale, { month: 'long', year: 'numeric' }) : '';
    const avatarId      = customAvatarId ?? user.avatarId ?? 'astronaut';
    const activeDecorId = customDecorId ?? user.activeDecorId ?? null;
    const headerColor   = customHeaderColor ?? user.headerColor ?? 'blue';
    const hc            = HEADER_COLORS.find((c) => c.id === headerColor) || HEADER_COLORS[0];
    const avatarCfg     = AVATARS_CATALOG.find((a) => a.id === avatarId) || AVATARS_CATALOG[0];
    const activeDecor   = DECORS_CATALOG.find((d) => d.id === activeDecorId);
    const nameColor     = activeDecor?.effect ? DECOR_EFFECT_COLORS[activeDecor.effect] : hc.accent;
    return {
      joinDate, hc, avatarCfg, activeDecorId, activeDecor, nameColor,
      themeStyle: { '--player-accent': hc.accent, '--player-accent-soft': hc.color, '--player-name-color': nameColor },
      avatarStyle: { background: `linear-gradient(135deg, #0a0a1a, ${hc.color})`, borderColor: hc.accent + '80' },
      decorClass: getDecorClass(activeDecorId),
    };
  }, [
    customAvatarId, customDecorId, customHeaderColor,
    user.avatarId, user.activeDecorId, user.headerColor, user.createdAt,
  ]);

  return (
    <div className="player-card-main" style={themeStyle}>
      <div className="player-card-avatar" style={avatarStyle}>
        <span className="player-card-avatar-icon">{avatarCfg.icon}</span>
      </div>
      <div className={`player-card-name ${decorClass}`} style={!activeDecor?.effect ? { color: nameColor } : undefined}>{applyDecor(user.firstName || user.username || 'Pilot', activeDecorId)}</div>
      {user.username && <div className="player-card-username">@{user.username}</div>}
      <div className="player-card-level">{t('profile.level', { level: user.level })}</div>
      {joinDate && <div className="player-card-joined">{t('profile.joinedAt', { date: joinDate })}</div>}

      {/* Mini tournament disabled */}
      {/* <button className="card-action-mini-tournament" onClick={() => onNav(CARD_VIEWS.miniTournament)}>
        {t('profile.miniTournamentBtn')}
      </button> */}

      <div className="player-card-actions">
        <button className="card-action-btn" onClick={() => onNav(CARD_VIEWS.achievements)}>
          <span className="card-action-icon"><Trophy size={18} /></span>
          <span className="card-action-label">{t('profile.achievementsBtn')}</span>
        </button>
        <button className="card-action-btn" onClick={() => onNav(CARD_VIEWS.stats)}>
          <span className="card-action-icon"><BarChart2 size={18} /></span>
          <span className="card-action-label">{t('profile.statsBtn')}</span>
        </button>
        <button className="card-action-btn" onClick={() => onNav(CARD_VIEWS.premium)}>
          <span className="card-action-icon"><Sparkles size={18} /></span>
          <span className="card-action-label">{t('profile.premiumBtn')}</span>
        </button>
        <button className="card-action-btn" onClick={() => onNav(CARD_VIEWS.custom)}>
          <span className="card-action-icon"><Palette size={18} /></span>
          <span className="card-action-label">{t('profile.customizationBtn')}</span>
        </button>
        <button className="card-action-btn" onClick={() => onNav(CARD_VIEWS.referral)}>
          <span className="card-action-icon"><Users size={18} /></span>
          <span className="card-action-label">{t('profile.referralBtn')}</span>
        </button>
        <button className="card-action-btn" onClick={() => onNav(CARD_VIEWS.leaderboard)}>
          <span className="card-action-icon"><Trophy size={18} /></span>
          <span className="card-action-label">{t('profile.leaderboardBtn')}</span>
        </button>
        <button
          className={`card-action-btn card-action-btn--prestige ${(user.prestigeLevel || 0) > 0 ? 'card-action-btn--prestige-active' : ''}`}
          onClick={() => onNav(CARD_VIEWS.prestige)}
        >
          <span className="card-action-icon">
            {(user.prestigeLevel || 0) > 0
              ? <span className="prestige-badge-icon" style={{ display: 'inline-flex', gap: 2 }}>
                  {Array.from({ length: user.prestigeLevel }).map((_, i) => (
                    <svg key={i} width={13} height={13} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M8 1L10 6.5H15.5L11 9.5L13 15L8 11.5L3 15L5 9.5L0.5 6.5H6L8 1Z" fill="currentColor" />
                    </svg>
                  ))}
                </span>
              : <Star size={18} />}
          </span>
          <span className="card-action-label">{t('profile.prestigeBtn')}</span>
        </button>
      </div>
    </div>
  );
});

const AndroidPlayerCardMain = memo(function AndroidPlayerCardMain({ user, onNav }) {
  const customAvatarId = useGameStore((s) => s.customization?.avatarId);
  const customDecorId = useGameStore((s) => s.customization?.activeDecorId);
  const customHeaderColor = useGameStore((s) => s.customization?.headerColor);

  const { joinDate, hc, avatarCfg, activeDecorId, activeDecor, nameColor } = useMemo(() => {
    const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US';
    const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString(locale, { month: 'long', year: 'numeric' }) : '';
    const avatarId = customAvatarId ?? user.avatarId ?? 'astronaut';
    const activeDecorId = customDecorId ?? user.activeDecorId ?? null;
    const headerColor = customHeaderColor ?? user.headerColor ?? 'blue';
    const hc = HEADER_COLORS.find((c) => c.id === headerColor) || HEADER_COLORS[0];
    const avatarCfg = AVATARS_CATALOG.find((a) => a.id === avatarId) || AVATARS_CATALOG[0];
    const activeDecor = DECORS_CATALOG.find((d) => d.id === activeDecorId);
    const nameColor = activeDecor?.effect ? DECOR_EFFECT_COLORS[activeDecor.effect] : hc.accent;
    return { joinDate, hc, avatarCfg, activeDecorId, activeDecor, nameColor };
  }, [
    customAvatarId, customDecorId, customHeaderColor,
    user.avatarId, user.activeDecorId, user.headerColor, user.createdAt,
  ]);

  const actions = [
    { key: CARD_VIEWS.achievements, label: t('profile.achievementsBtn'), Icon: Trophy },
    { key: CARD_VIEWS.stats, label: t('profile.statsBtn'), Icon: BarChart2 },
    { key: CARD_VIEWS.premium, label: t('profile.premiumBtn'), Icon: Sparkles },
    { key: CARD_VIEWS.custom, label: t('profile.customizationBtn'), Icon: Palette },
    { key: CARD_VIEWS.referral, label: t('profile.referralBtn'), Icon: Users },
    { key: CARD_VIEWS.leaderboard, label: t('profile.leaderboardBtn'), Icon: Trophy },
    { key: CARD_VIEWS.prestige, label: t('profile.prestigeBtn'), Icon: Star },
  ];

  return (
    <div className="android-profile-card">
      <div className="android-profile-avatar" style={{ borderColor: `${hc.accent}80` }}>
        <span>{avatarCfg.icon}</span>
      </div>
      <div className="android-profile-name" style={{ color: nameColor }}>
        {applyDecor(user.firstName || user.username || 'Pilot', activeDecorId)}
      </div>
      {user.username && <div className="android-profile-username">@{user.username}</div>}
      <div className="android-profile-level">{t('profile.level', { level: user.level })}</div>
      {joinDate && <div className="android-profile-joined">{t('profile.joinedAt', { date: joinDate })}</div>}

      <div className="android-profile-actions">
        {actions.map(({ key, label, Icon }) => (
          <button key={key} className="android-profile-action" onClick={() => onNav(key)}>
            <span className="android-profile-action-icon">
              {key === CARD_VIEWS.prestige && (user.prestigeLevel || 0) > 0 ? (
                <span className="android-profile-prestige">{user.prestigeLevel}</span>
              ) : (
                <Icon size={18} />
              )}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

function MiniTournamentView({ data }) {
  if (!data) {
    return (
      <div className="player-section-empty">
        <span className="player-section-empty-icon"><Gift size={32} /></span>
        <h3 className="player-section-empty-title">{t('miniTournament.title')}</h3>
        <p className="player-section-empty-text">{t('miniTournament.loadError')}</p>
      </div>
    );
  }

  return (
    <div className="player-stats-view">
      <div className="stat-section">
        <div className="stat-empty" style={{ textAlign: 'left', paddingBottom: 8 }}>
          {t('miniTournament.subtitle', { count: data.expeditionsPerGift || 100 })}
        </div>
        {!data.isActive && <div className="stat-empty">{t('miniTournament.inactive')}</div>}
      </div>

      <div className="stat-section">
        <div className="stat-section-title">{t('miniTournament.title')}</div>
        <div className="stat-row">
          <span className="stat-label">{t('miniTournament.totalExpeditions')}</span>
          <span className="stat-value">{Number(data.expeditionsCount || 0).toLocaleString()}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">{t('miniTournament.giftsIssued')}</span>
          <span className="stat-value">{Number(data.giftsIssued || 0).toLocaleString()}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">{t('miniTournament.giftsPending')}</span>
          <span className="stat-value">{Number(data.giftsPending || 0).toLocaleString()}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">{t('miniTournament.toNextGift')}</span>
          <span className="stat-value">{Number(data.expeditionsToNextGift || 0).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

function PlayerSectionEmpty({ title, icon, text }) {
  return (
    <div className="player-section-empty">
      <span className="player-section-empty-icon">{icon}</span>
      <h3 className="player-section-empty-title">{title}</h3>
      <p className="player-section-empty-text">{text}</p>
    </div>
  );
}

// ─── PlayerStatsView ──────────────────────────────────────────────────────────
const STATS_RARITY_LABELS = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythical: 'Mythical' };
const STATS_RARITY_COLORS = { common: '#9e9e9e', rare: '#2196f3', epic: '#9c27b0', legendary: '#ffc107', mythical: '#f44336' };
const TYPE_KEYS = ['debris', 'artifact', 'creature', 'anomaly', 'asteroid', 'nft_container'];

// U2 Statistics constants
const U2_STATS_RARITY_LABELS = { exotic: 'Exotic', ancient: 'Ancient', relic: 'Relic', hybrid: 'Hybrid', singularity: 'Singularity' };
const U2_STATS_RARITY_COLORS = { exotic: '#81c784', ancient: '#7986cb', relic: '#ff7043', hybrid: '#9575cd', singularity: '#ef5350' };
const U2_TYPE_KEYS = ['echo', 'relic', 'entity', 'rift', 'asteroid'];

function StatRow({ label, value, sub, color }) {
  return (
    <div className="stat-row">
      <span className="stat-label" style={color ? { color } : undefined}>{label}</span>
      <span className="stat-value">{value ?? '—'}{sub && <span className="stat-sub"> {sub}</span>}</span>
    </div>
  );
}

function StatSection({ title, children }) {
  return (
    <div className="stat-section">
      <div className="stat-section-title">{title}</div>
      {children}
    </div>
  );
}

function PlayerStatsView({ stats, loading, onRefresh }) {
  if (loading && !stats) {
    return <div className="center-spinner" style={{ minHeight: 200 }}><span className="spinner spinner-lg" /></div>;
  }
  if (!stats) {
    return (
      <div className="player-section-empty">
        <span className="player-section-empty-icon"><BarChart2 size={32} /></span>
        <h3 className="player-section-empty-title">{t('stats.title')}</h3>
        <p className="player-section-empty-text">{t('stats.loadError')}</p>
        <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={onRefresh}>{t('common.retry')}</button>
      </div>
    );
  }

  const r = stats.records;

  return (
    <div className="player-stats-view">
      <div className="stats-header-row">
        <button className="stats-refresh-btn" onClick={onRefresh} disabled={loading} title={t('common.refresh')}>
          {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '↻'}
        </button>
      </div>

      <StatSection title={t('stats.expeditions')}>
        <StatRow label={t('stats.totalExpeditions')} value={stats.totalExpeditions.toLocaleString()} />
        <StatRow label={t('stats.expeditionsToday')} value={stats.expeditionsToday.toLocaleString()} />
        <StatRow label={t('stats.totalFinds')} value={stats.totalFinds.toLocaleString()} />
        <StatRow label={t('stats.totalSold')} value={stats.totalSold.toLocaleString()} />
      </StatSection>

      <StatSection title={t('stats.byType')}>
        {TYPE_KEYS.map((k) =>
          stats.findsByType[k] > 0 && <StatRow key={k} label={t(`findTypeIcon.${k}`)} value={stats.findsByType[k].toLocaleString()} />
        )}
      </StatSection>

      <StatSection title={t('stats.byRarity')}>
        {Object.entries(STATS_RARITY_LABELS).map(([k, lbl]) => (
          <StatRow key={k} label={lbl} value={stats.findsByRarity[k].toLocaleString()} color={STATS_RARITY_COLORS[k]} />
        ))}
      </StatSection>

      <StatSection title={t('stats.economy')}>
        <StatRow label={t('stats.totalEarned')} value={<>{stats.totalCreditsEarned.toLocaleString()} <CoinIcon size={11} style={{verticalAlign:'middle'}} /></>} />
        <StatRow label={t('stats.inventoryValue')} value={<>~{stats.inventoryValue.toLocaleString()} <CoinIcon size={11} style={{verticalAlign:'middle'}} /></>} />
        {stats.mostExpensiveFind && (
          <StatRow
            label={t('stats.bestFind')}
            value={<>{stats.mostExpensiveFind.value.toLocaleString()} <CoinIcon size={11} style={{verticalAlign:'middle'}} /></>}
            sub={`— ${localizeStatsObjectName(stats.mostExpensiveFind.name, stats.mostExpensiveFind.templateId)} (${stats.mostExpensiveFind.rarity})`}
            color={STATS_RARITY_COLORS[stats.mostExpensiveFind.rarity]}
          />
        )}
      </StatSection>

      <StatSection title={t('stats.pirates')}>
        <StatRow label={t('stats.pirateEncounters')} value={stats.pirateEncounters.toLocaleString()} />
        <StatRow label={t('stats.pirateWins')} value={stats.pirateFightWins.toLocaleString()} />
        <StatRow label={t('stats.pirateLosses')} value={stats.pirateFightLosses.toLocaleString()} />
      </StatSection>

      {stats.hasVisitedUniverse2 && stats.u2_findsByType && (
        <>
          <StatSection title={t('stats.u2ByType')}>
            {U2_TYPE_KEYS.map((k) =>
              stats.u2_findsByType[k] > 0 && <StatRow key={k} label={t(`findTypeIcon.${k}`)} value={stats.u2_findsByType[k].toLocaleString()} />
            )}
          </StatSection>

          <StatSection title={t('stats.u2ByRarity')}>
            {Object.entries(U2_STATS_RARITY_LABELS).map(([k, lbl]) => (
              <StatRow key={k} label={lbl} value={stats.u2_findsByRarity[k].toLocaleString()} color={U2_STATS_RARITY_COLORS[k]} />
            ))}
          </StatSection>
        </>
      )}

      <StatSection title={t('stats.collectionTitle')}>
        <StatRow label={t('stats.inventoryItems')} value={(stats.inventoryCount ?? 0).toLocaleString()} />
        <StatRow label={t('stats.nftContainers')} value={stats.findsByType.nft_container.toLocaleString()} />
        <StatRow label={t('stats.uniqueFinds')} value={`${stats.uniqueTemplatesFound} / ${stats.totalUniqueTemplates}`} />
        <StatRow label={t('stats.collectionFill')} value={`${stats.collectionCompletionPct}%`} />
      </StatSection>

      <StatSection title={t('stats.records')}>
        {r.heaviestCreature && (
          <StatRow
            label={t('stats.heaviestCreature')}
            value={r.heaviestCreature.val >= 1000 ? `${(r.heaviestCreature.val / 1000).toFixed(1)} ${t('units.t')}` : `${r.heaviestCreature.val} ${t('units.kg')}`}
            sub={`— ${localizeStatsObjectName(r.heaviestCreature.name)}`}
            color={STATS_RARITY_COLORS[r.heaviestCreature.rarity]}
          />
        )}
        {r.heaviestDebris && (
          <StatRow
            label={t('stats.heaviestDebris')}
            value={`${r.heaviestDebris.val} ${t('units.kg')}`}
            sub={`— ${localizeStatsObjectName(r.heaviestDebris.name)}`}
            color={STATS_RARITY_COLORS[r.heaviestDebris.rarity]}
          />
        )}
        {r.largestAsteroid && (
          <StatRow
            label={t('stats.largestAsteroid')}
            value={`${r.largestAsteroid.val.toLocaleString()} ${t('units.t')}`}
            sub={r.largestAsteroid.name ? `— ${localizeStatsObjectName(r.largestAsteroid.name)}` : undefined}
          />
        )}
        {r.rarestArtifact && (
          <StatRow
            label={t('stats.rarestArtifact')}
            value={STATS_RARITY_LABELS[r.rarestArtifact.rarity] || r.rarestArtifact.rarity}
            sub={`— ${localizeStatsObjectName(r.rarestArtifact.name)}`}
            color={STATS_RARITY_COLORS[r.rarestArtifact.rarity]}
          />
        )}
        {!r.heaviestCreature && !r.heaviestDebris && !r.largestAsteroid && !r.rarestArtifact && (
          <div className="stat-empty">{t('stats.noRecords')}</div>
        )}
      </StatSection>
    </div>
  );
}

// ─── PlayerAchievementsView ───────────────────────────────────────────────────
function PlayerAchievementsView({ achievements, user }) {
  const { selectAchievement, _setAchievementBadge } = useGameStore();
  const [selecting, setSelecting] = useState(null);

  const handleSelect = async (ach) => {
    // Toggle off if already selected
    const newId = user.selectedAchievement?.id === ach.id ? null : ach.id;
    setSelecting(ach.id);
    try {
      await selectAchievement(newId);
      _setAchievementBadge(newId ? { id: ach.id, name: ach.name, icon: ach.icon } : null);
    } finally {
      setSelecting(null);
    }
  };

  if (!achievements) {
    return <div className="center-spinner" style={{ minHeight: 200 }}><span className="spinner spinner-lg" /></div>;
  }

  const completed  = achievements.filter((a) => a.completed);
  const incomplete = achievements.filter((a) => !a.completed);

  return (
    <div className="player-achievements-view">
      {completed.length === 0 && (
        <div className="stat-empty" style={{ marginTop: 16 }}>{t('achievements.noCompleted')}</div>
      )}
      {completed.length > 0 && (
        <>
          <div className="ach-section-label">{t('achievements.completed', { count: completed.length })}</div>
          {completed.map((ach) => {
            const localized = localizeAchievement(ach);
            const isSelected = user.selectedAchievement?.id === ach.id;
            const isBusy = selecting === ach.id;
            return (
              <div key={ach.id} className={`ach-row ach-done ${isSelected ? 'ach-selected' : ''}`}>
                <span className="ach-icon">{ach.icon}</span>
                <div className="ach-info">
                  <span className="ach-name">{localized.name}</span>
                  <span className="ach-desc">{localized.description}</span>
                </div>
                <button
                  className={`ach-select-btn ${isSelected ? 'ach-select-btn--active' : ''}`}
                  onClick={() => handleSelect(ach)}
                  disabled={!!selecting}
                >
                  {isBusy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : (isSelected ? t('achievements.chosen') : t('achievements.choose'))}
                </button>
              </div>
            );
          })}
        </>
      )}
      {incomplete.length > 0 && (
        <>
          <div className="ach-section-label" style={{ marginTop: 16 }}>{t('achievements.inProgress', { count: incomplete.length })}</div>
          {incomplete.map((ach) => {
            const localized = localizeAchievement(ach);
            return (
              <div key={ach.id} className="ach-row ach-locked">
                <span className="ach-icon" style={{ opacity: 0.4 }}>{ach.icon}</span>
                <div className="ach-info">
                  <span className="ach-name">{localized.name}</span>
                  <span className="ach-desc">{localized.description}</span>
                  {(ach.progress > 0 || ach.target != null) && (
                    <span className="ach-progress">
                      {ach.progress.toLocaleString()} / {ach.target != null ? ach.target.toLocaleString() : '?'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── CustomizationView ────────────────────────────────────────────────────────
function CustomizationView({ user }) {
  const { customization, setHeaderColor, setAvatar, purchaseDecor, setDecor, setZoneGlow } = useGameStore();
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const name = user.firstName || user.username || t('profile.pilot');
  const activeDecorId  = customization?.activeDecorId  ?? user.activeDecorId  ?? null;
  const activeColor    = customization?.headerColor     ?? user.headerColor    ?? 'blue';
  const activeAvatar   = customization?.avatarId        ?? user.avatarId       ?? 'astronaut';
  const ownedDecors    = customization?.ownedDecors     ?? [];
  const lang = getLang();

  const colorCfg = HEADER_COLORS.find((c) => c.id === activeColor) || HEADER_COLORS[0];
  const avatarCfg = AVATARS_CATALOG.find((a) => a.id === activeAvatar) || AVATARS_CATALOG[0];

  const handleColor = async (id) => {
    if (busy) return;
    setBusy('color_' + id);
    try { await setHeaderColor(id); } catch (e) { showToast(e.message || t('common.error'), 'err'); }
    finally { setBusy(null); }
  };

  const handleAvatar = async (id) => {
    if (busy) return;
    setBusy('avatar_' + id);
    try { await setAvatar(id); } catch (e) { showToast(e.message || t('common.error'), 'err'); }
    finally { setBusy(null); }
  };

  const handleBuyDecor = async (decorId) => {
    if (busy) return;
    setBusy('buy_' + decorId);
    try {
      await purchaseDecor(decorId);
      showToast(t('customization.buySuccess'));
    } catch (e) { showToast(e.message || t('shop.purchaseError'), 'err'); }
    finally { setBusy(null); }
  };

  const handleLanguageSwitch = (nextLang) => {
    if (nextLang === lang) return;
    setLang(nextLang);
    showToast(t('customization.languageChanged'));
  };

  const handleSetDecor = async (decorId) => {
    if (busy) return;
    const next = decorId === activeDecorId ? null : decorId;
    setBusy('set_' + decorId);
    try { await setDecor(next); } catch (e) { showToast(e.message || t('common.error'), 'err'); }
    finally { setBusy(null); }
  };

  if (!customization) {
    return <div className="center-spinner" style={{ minHeight: 200 }}><span className="spinner spinner-lg" /></div>;
  }

  return (
    <div className="custom-view">
      {toast && (
        <div className={`custom-toast ${toast.type === 'err' ? 'custom-toast--err' : ''}`}>{toast.msg}</div>
      )}

      {/* Preview */}
      <div className="custom-preview" style={{ background: `linear-gradient(135deg, #0a0a1a, ${colorCfg.color})` }}>
        <div className="custom-preview-avatar" style={{ borderColor: colorCfg.accent }}>
          {avatarCfg.icon}
        </div>
        <div
          className="custom-preview-name"
          style={{
            color: (() => {
              const d = DECORS_CATALOG.find(x => x.id === activeDecorId);
              return d?.effect ? DECOR_EFFECT_COLORS[d.effect] : colorCfg.accent;
            })()
          }}
        >
          {applyDecor(name, activeDecorId)}
        </div>
        <div className="custom-preview-sub">{t('profile.level', { level: user.level })}</div>
      </div>

      {/* Language */}
      <div className="custom-section-title">{t('customization.language')}</div>
      <div className="custom-lang-row">
        <button
          className={`custom-lang-btn ${lang === 'ru' ? 'active' : ''}`}
          onClick={() => handleLanguageSwitch('ru')}
          disabled={!!busy}
        >
          {t('customization.languageRu')}
        </button>
        <button
          className={`custom-lang-btn ${lang === 'en' ? 'active' : ''}`}
          onClick={() => handleLanguageSwitch('en')}
          disabled={!!busy}
        >
          {t('customization.languageEn')}
        </button>
      </div>

      {/* Header color */}
      <div className="custom-section-title">{t('customization.panelColor')}</div>
      <div className="custom-colors-row">
        {HEADER_COLORS.map((c) => (
          <button
            key={c.id}
            className={`custom-color-dot ${activeColor === c.id ? 'active' : ''}`}
            style={{ background: c.color, boxShadow: activeColor === c.id ? `0 0 0 3px ${c.accent}` : undefined }}
            onClick={() => handleColor(c.id)}
            title={c.label}
            disabled={!!busy}
          />
        ))}
      </div>

      {/* Avatar */}
      <div className="custom-section-title">{t('customization.avatar')}</div>
      <div className="custom-avatars-row">
        {AVATARS_CATALOG.map((a) => (
          <button
            key={a.id}
            className={`custom-avatar-btn ${activeAvatar === a.id ? 'active' : ''}`}
            onClick={() => handleAvatar(a.id)}
            title={a.label}
            disabled={!!busy}
            style={{ borderColor: activeAvatar === a.id ? colorCfg.accent : undefined }}
          >
            {a.icon}
          </button>
        ))}
      </div>

      {/* Nick decorations */}
      <div className="custom-section-title">{t('customization.nickDecor')}</div>
      <div className="custom-decors-list">
        {DECORS_CATALOG.map((d) => {
          // Captain decoration: only visible for ship owners
          if (d.id === 'fx_captain' && !user?.hasShip) return null;
          const isU2CrystalDecor = Number(d.costCrystals || 0) > 0;
          if (isU2CrystalDecor && !user?.hasVisitedUniverse2) return null;
          const owned = ownedDecors.includes(d.id);
          const isCaptainExclusive = d.id === 'fx_captain';
          const isActive = activeDecorId === d.id;
          const isBusy = busy === 'buy_' + d.id || busy === 'set_' + d.id;
          const PriceIcon = Number(d.costCrystals || 0) > 0 ? CrystalIcon : Star;
          const priceAmt = Number(d.costCrystals || 0) > 0 ? d.costCrystals : d.costStars;
          return (
            <div key={d.id} className={`custom-decor-row ${isActive ? 'active' : ''}`}>
              <div className="custom-decor-preview-wrap">
                <span
                  className={`custom-decor-preview ${d.effect ? `decor-fx-${d.effect}` : ''}`}
                >{d.preview(name)}</span>
                {d.effect && (
                  <span className="custom-decor-effect-chip" style={{ background: DECOR_EFFECT_COLORS[d.effect] + '22', color: DECOR_EFFECT_COLORS[d.effect], borderColor: DECOR_EFFECT_COLORS[d.effect] + '55' }}>
                    {isCaptainExclusive ? t('customization.exclusive') : t('customization.effect')}
                  </span>
                )}
              </div>
              {owned ? (
                <button
                  className={`custom-decor-btn ${isActive ? 'custom-decor-btn--active' : ''}`}
                  onClick={() => handleSetDecor(d.id)}
                  disabled={isBusy}
                >
                  {isBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : isActive ? t('customization.active') : t('customization.select')}
                </button>
              ) : (
                <button
                  className="custom-decor-btn custom-decor-btn--buy"
                  onClick={() => handleBuyDecor(d.id)}
                  disabled={isBusy}
                >
                  {isBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <><PriceIcon size={11} style={{verticalAlign:'middle',marginRight:2}} />{priceAmt}</>}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Zone glow toggle — visible if supporter or ship owner */}
      {(customization?.isSupporter || user?.hasShip) && (() => {
        const currentGlow = customization?.zoneGlow || null;
        const glowOptions = [
          { id: null, label: t('customization.glowOff'), icon: '⬜' },
          ...(customization?.isSupporter ? [{ id: 'supporter', label: t('customization.glowSupporter'), icon: '🌟' }] : []),
          ...(user?.hasShip ? [{ id: 'captain', label: t('customization.glowCaptain'), icon: '🚀' }] : []),
        ];
        const handleGlow = async (id) => {
          if (busy) return;
          setBusy('glow_' + id);
          try { await setZoneGlow(id); showToast(t('customization.glowUpdated')); }
          catch (e) { showToast(e.message || t('common.error'), 'err'); }
          finally { setBusy(null); }
        };
        return (
          <>
            <div className="custom-section-title">{t('customization.zoneGlow')}</div>
            <div className="custom-glow-list">
              {glowOptions.map((opt) => (
                <button
                  key={opt.id ?? 'off'}
                  className={`custom-glow-btn ${currentGlow === opt.id ? 'active' : ''}`}
                  onClick={() => handleGlow(opt.id)}
                  disabled={!!busy}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                  {currentGlow === opt.id && <span className="custom-glow-check">✓</span>}
                </button>
              ))}
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ─── PremiumView ──────────────────────────────────────────────────────────────
function PremiumView({ user }) {
  const { customization, loadCustomization } = useGameStore();
  const [buying, setBuying] = useState(false);
  const [supported, setSupported] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const isSupporter = supported ||
    customization?.isSupporter ||
    customization?.ownedDecors?.includes('supporter') ||
    user?.isSupporter;

  const handleBuy = async () => {
    if (buying || isSupporter) return;
    setBuying(true);
    try {
      const res = await customizationApi.purchaseSupport();
      if (res?.ok) {
        setSupported(true);      // optimistic — instant UI update
        showToast(t('premium.thankYou'));
        loadCustomization();     // refresh store in background
      }
    } catch (e) {
      showToast(e.message || t('shop.purchaseError'), 'err');
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="premium-view">
      {toast && (
        <div className={`custom-toast ${toast.type === 'err' ? 'custom-toast--err' : ''}`}>{toast.msg}</div>
      )}

      <p className="premium-sub" style={{textAlign:'center',marginBottom:16,color:'var(--text-muted)'}}>{t('premium.subtitle')}</p>

      <div className={`premium-item ${isSupporter ? 'premium-item--owned' : ''}`}>
        <div className="premium-item-top">
          <span className="premium-item-icon">🌟</span>
          <div className="premium-item-info">
            <span className="premium-item-name">{t('premium.supportProject')}</span>
            <span className="premium-item-price">{isSupporter ? t('premium.purchased') : t('premium.supportPrice')}</span>
          </div>
        </div>
        <div className="premium-item-perks">
          <span className="premium-perk">{t('premium.perkNft')}</span>
          <span className="premium-perk">{t('premium.perkMythical')}</span>
          <span className="premium-perk">{t('premium.perkLegendary')}</span>
        </div>
        <p className="premium-item-desc">{t('premium.supportDesc')}</p>
        {!isSupporter ? (
          <button className="btn btn-premium" onClick={handleBuy} disabled={buying}>
            {buying ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t('premium.supportBtn')}
          </button>
        ) : (
          <div className="premium-owned-badge">{t('premium.thankYou')}</div>
        )}
      </div>

      {/* Ship NFT display (not purchasable) */}
      {user?.hasShip && (
        <div className="premium-item premium-item--owned premium-item--ship">
          <div className="premium-item-top">
            <span className="premium-item-icon"><Rocket size={28} /></span>
            <div className="premium-item-info">
              <span className="premium-item-name">{t('premium.uniqueShip')}</span>
              <span className="premium-item-price">{t('premium.shipInCollection')}</span>
            </div>
          </div>
          <div className="premium-item-perks">
            <span className="premium-perk">{t('premium.perkRole')}</span>
            <span className="premium-perk">{t('premium.perkGlow')}</span>
            <span className="premium-perk">{t('premium.perkStarBonus')}</span>
          </div>
          <p className="premium-item-desc">{t('premium.shipDesc')}</p>
          <div className="premium-owned-badge">{t('premium.shipLabel')}</div>
        </div>
      )}

      {/* Channel subscriber bonus (not purchasable) */}
      {user?.isChannelMember && (
        <div className="premium-item premium-item--owned">
          <div className="premium-item-top">
            <span className="premium-item-icon">📺</span>
            <div className="premium-item-info">
              <span className="premium-item-name">{t('subscriber.title')}</span>
              <span className="premium-item-price">{t('subscriber.badge')}</span>
            </div>
          </div>
          <div className="premium-item-perks">
            <span className="premium-perk">{t('subscriber.perkExpedition')}</span>
          </div>
          <p className="premium-item-desc">{t('subscriber.desc')}</p>
          <div className="premium-owned-badge">{t('subscriber.badge')}</div>
        </div>
      )}
    </div>
  );
}
