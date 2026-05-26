import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from '../../utils/safeMotion';
import { useGameStore } from '../../store/gameStore';
import { useTelegram } from '../../hooks/useTelegram';
import StarsWallet from '../ui/StarsWallet';
import { upgradesApi } from '../../services/api';
import { t, isRu } from '../../i18n';
import { localizeModuleName, localizeStarUpgradeDescription, localizeStarUpgradeLabel } from '../../i18n/entities';
import { ScannerIcon, SignalAmplifierIcon, Package, FlaskConical, Shield, ScrollText, Map, Telescope, Zap, Satellite, Rocket, Gift, Cog, ArrowUp, CrystalIcon, CoinIcon, Star, Skull, Atom, AnomalyIcon, Sparkles, Lock, Hourglass } from '../../icons';

const TAP_SCALE = { scale: 0.96 };
const TAP_NOOP  = {};

const MODULE_ICON_COMPONENTS = { scanner: ScannerIcon, cargo: Package, capsule: FlaskConical };

const STAR_UPGRADE_ICONS = {
  pirate_suppressor:  Skull,
  research_lab:       Atom,
  gravity_stabilizer: AnomalyIcon,
  advanced_scanner:   Telescope,
};

const STORY_ITEM_ICONS = {
  signal_from_another_universe: SignalAmplifierIcon,
  particle_decelerator:         Atom,
  chrono_timer:                 Hourglass,
  void_cannon:                  Skull,
  resonator_particle:           Atom,
  hyperlane_beacon:             Rocket,
};
const RARITY_NAMES = () => [
  '—',
  t('rarity.common'),
  t('rarity.rare'),
  t('rarity.epic'),
  t('rarity.legendary'),
  t('rarity.mythical'),
  t('rarity.exotic'),
  t('rarity.ancient'),
  t('rarity.relic'),
  t('rarity.hybrid'),
  t('rarity.singularity'),
];
const MODULE_STAT_LABELS = {
  scanner: (s) => s?.scansUpTo
    ? t('upgrades.scannerStat', { rarity: RARITY_NAMES()[s.scansUpTo], mult: s.rarityMultiplier })
    : t('upgrades.scannerNA'),
  cargo:   (s) => t('upgrades.cargoStat', { vol: s?.maxVolume ?? 30 }),
  capsule: (s) => s?.capturesUpTo
    ? t('upgrades.capsuleStat', { rarity: RARITY_NAMES()[s.capturesUpTo] })
    : t('upgrades.capsuleNA'),
};

const SHOP_ITEMS_CREDITS = [
  { id: 'signal_amplifier_basic',    Icon: SignalAmplifierIcon, labelKey: 'shopItem.signal_base_name',  costCredits: 1500,  costLabelKey: 'shopItem.signal_base_price',  descKey: 'shopItem.signal_base_desc' },
  { id: 'signal_amplifier_advanced', Icon: SignalAmplifierIcon, labelKey: 'shopItem.signal_adv_name',   costCredits: 2000,  costLabelKey: 'shopItem.signal_adv_price',   descKey: 'shopItem.signal_adv_desc' },
  { id: 'stealth_module',            Icon: Shield,      labelKey: 'shopItem.stealth_name',      costCredits: 4000,  costLabelKey: 'shopItem.stealth_price',      descKey: 'shopItem.stealth_desc' },
  { id: 'insurance_policy',          Icon: ScrollText,  labelKey: 'shopItem.insurance_name',    costCredits: 1500,  costLabelKey: 'shopItem.insurance_price',    descKey: 'shopItem.insurance_desc' },
  { id: 'cartographer',              Icon: Map,         labelKey: 'shopItem.cartographer_name', costCredits: 1000,  costLabelKey: 'shopItem.cartographer_price', descKey: 'shopItem.cartographer_desc' },
  { id: 'quantum_locator',           Icon: Telescope,   labelKey: 'shopItem.quantum_name',     costCredits: 30000, costLabelKey: 'shopItem.quantum_price',      descKey: 'shopItem.quantum_desc', minLevel: 15 },
  { id: 'blitz_cooldown_reducer',    Icon: Zap,         labelKey: 'shopItem.blitz_cooldown_reducer_name', costCredits: 3000, descKey: 'shopItem.blitz_cooldown_reducer_desc' },
];
const SHOP_ITEMS_STARS = [
  { id: 'signal_amplifier_star', Icon: SignalAmplifierIcon, labelKey: 'shopItem.signal_star_name', costStars: 15, costLabelKey: 'shopItem.signal_star_price', descKey: 'shopItem.signal_star_desc' },
  { id: 'turbo_engine',         Icon: Zap,         labelKey: 'shopItem.turbo_name',       costStars: 25, costLabelKey: 'shopItem.turbo_price',       descKey: 'shopItem.turbo_desc' },
  { id: 'remote_scanner',        Icon: Satellite,   labelKey: 'shopItem.remote_scanner_name', costStars: 10, costLabelKey: 'shopItem.remote_scanner_price', descKey: 'shopItem.remote_scanner_desc' },
  { id: 'blitz_stabilizer',      Icon: Shield,      labelKey: 'shopItem.blitz_stabilizer_name', costStars: 30, descKey: 'shopItem.blitz_stabilizer_desc' },
];

function CategorySection({ storeKey, title, children }) {
  const { shopAccordions, setShopAccordion } = useGameStore();
  const open = shopAccordions[storeKey] ?? false;
  const toggle = () => setShopAccordion(storeKey, !open);
  return (
    <div className="shop-category">
      <button className="shop-category-header" onClick={toggle}>
        <span>{title}</span>
        <span className="shop-category-arrow">{open ? '▲' : '▼'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="shop-category-body"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BuffItemCard({ item, payWith, onBuy, user, activeBuffs, buyingId }) {
  const [descOpen, setDescOpen] = useState(false);
  const active = activeBuffs.find((b) => {
    const buffType = item.id.startsWith('signal_amplifier') ? 'signal_amplifier' : item.id;
    return b.buff_type === buffType;
  });
  const locked = !!(item.minLevel && user?.level < item.minLevel);
  const canAfford = locked ? false
    : item.costCredits ? (user?.credits ?? 0) >= item.costCredits
    : item.costStars   ? (user?.starsBalance ?? 0) >= item.costStars
    : false;
  const isBuying = buyingId === item.id;
  const disabled = locked || !canAfford || isBuying;
  let statusLabel = null;
  if (active) {
    if (active.expires_at) {
      const mins = Math.round((new Date(active.expires_at) - Date.now()) / 60000);
      statusLabel = mins > 0 ? t('shop.activeMin', { mins }) : t('shop.expiring');
    } else if (active.uses_remaining != null) {
      statusLabel = t('shop.activeUses', { uses: active.uses_remaining });
    }
  }
  return (
    <div className={`buff-item-card ${active ? 'buff-active' : ''} ${locked ? 'buff-locked' : ''}`}>
      <button className="buff-info-btn" onClick={() => setDescOpen((v) => !v)} aria-label={t('upgrades.description')}>?</button>
      <div className="buff-item-left">
        <span className="buff-item-icon">{item.Icon && <item.Icon size={22} />}</span>
        <div className="buff-item-info">
          <span className="buff-item-label">{t(item.labelKey)}</span>
          {locked && item.minLevel && <span className="buff-level-req">{t('shop.levelReq', { level: item.minLevel })}</span>}
          {statusLabel && <span className="buff-status-label">{statusLabel}</span>}
          <AnimatePresence>
            {descOpen && (
              <motion.span className="buff-item-desc"
                initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }}
                exit={{ opacity:0, height:0 }} transition={{ duration:0.18 }}
                style={{ overflow:'hidden', display:'block' }}
              >{t(item.descKey)}</motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
      <motion.button
        className={`btn ${canAfford && !locked ? 'btn-primary' : 'btn-disabled'}`}
        onClick={() => !disabled && onBuy(item.id, payWith)}
        disabled={disabled} whileTap={!disabled ? TAP_SCALE : TAP_NOOP}
      >{isBuying ? <span className="spinner" /> : (
        item.costCredits
          ? <><CoinIcon size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />{item.costCredits.toLocaleString()}</>
          : <><Star size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />{item.costStars}</>
      )}</motion.button>
    </div>
  );
}

function ModuleCard({ type, mod, onUpgrade, loading }) {
  const moduleLabel = localizeModuleName(type, mod.label);
  return (
    <div className="module-card">
      <div className="module-header">
        <span className="module-icon">{MODULE_ICON_COMPONENTS[type] && (() => { const I = MODULE_ICON_COMPONENTS[type]; return <I size={22} />; })()}</span>
        <div className="module-info">
          <span className="module-name">{moduleLabel}</span>
          <span className="module-level">
            {t('shop.currentLevel', { current: mod.currentLevel, max: mod.maxLevel })}
            {mod.isMaxed && <span className="maxed-badge"> {t('common.max')}</span>}
          </span>
        </div>
      </div>
      <div className="level-bar">
        <div className="level-fill" style={{ width:`${(mod.currentLevel/mod.maxLevel)*100}%` }}/>
      </div>
      <p className="module-stats current">{t('shop.currentStat')} {MODULE_STAT_LABELS[type]?.(mod.currentStats)}</p>
      {!mod.isMaxed && mod.nextStats && (
        <p className="module-stats next">{t('shop.afterStat')} {MODULE_STAT_LABELS[type]?.(mod.nextStats)}</p>
      )}
      {!mod.isMaxed ? (
        <motion.button
          className={`btn ${mod.canAfford ? 'btn-primary' : 'btn-disabled'}`}
          onClick={() => onUpgrade(type)} disabled={!mod.canAfford || loading}
          whileTap={mod.canAfford ? TAP_SCALE : TAP_NOOP}
        >
          {loading ? <span className="spinner"/> : mod.usesCrystals ? (
            <><ArrowUp size={13} style={{verticalAlign:'middle',marginRight:3}} />{t('shop.upgradeCost', { cost: mod.costCrystals?.toLocaleString() })}<CrystalIcon size={13} style={{verticalAlign:'middle',marginLeft:3}} /></>
          ) : (
            <><ArrowUp size={13} style={{verticalAlign:'middle',marginRight:3}} />{t('shop.upgradeCost', { cost: mod.upgradeCost?.toLocaleString() })}<CoinIcon size={13} style={{verticalAlign:'middle',marginLeft:3}} /></>
          )}
        </motion.button>
      ) : (
        <div className="maxed-message">{t('shop.maxLevel')}</div>
      )}
    </div>
  );
}

function StarUpgradeCard({ def, onUpgrade, buyingId, starsBalance, scannerLevel }) {
  const locked = def.requiresScannerLevel && scannerLevel < def.requiresScannerLevel;
  const isMaxed = def.currentLevel >= def.maxLevel;
  const canAfford = !locked && !isMaxed && (starsBalance ?? 0) >= def.costStarsPerLevel;
  const isBuying = buyingId === def.id;

  const label = localizeStarUpgradeLabel(def);
  const description = localizeStarUpgradeDescription(def);

  return (
    <div className={`module-card ${locked ? 'module-card--locked' : ''}`}>
      <div className="module-header">
        <span className="module-icon">{(() => { const I = STAR_UPGRADE_ICONS[def.id]; return I ? <I size={22} /> : def.icon; })()}</span>
        <div className="module-info">
          <span className="module-name">{label}</span>
          <span className="module-level">
            {locked
              ? <span className="buff-level-req"><Lock size={11} style={{verticalAlign:'middle',marginRight:3}} />{t('shop.scannerRequired', { level: def.requiresScannerLevel })}</span>
              : <>{t('shop.currentLevel', { current: def.currentLevel, max: def.maxLevel })}{isMaxed && <span className="maxed-badge"> {t('common.max')}</span>}</>
            }
          </span>
        </div>
      </div>
      {!locked && (
        <div className="level-bar">
          <div className="level-fill" style={{ width:`${(def.currentLevel/def.maxLevel)*100}%` }}/>
        </div>
      )}
      <p className="module-stats current">{description}</p>
      {!isMaxed && !locked && (
        <motion.button
          className={`btn ${canAfford ? 'btn-primary' : 'btn-disabled'}`}
          onClick={() => onUpgrade(def.id)} disabled={!canAfford || isBuying || locked}
          whileTap={canAfford ? TAP_SCALE : TAP_NOOP}
        >
          {isBuying ? <span className="spinner"/> : <><ArrowUp size={13} style={{verticalAlign:'middle',marginRight:3}} />{t('shop.upgradeStarCost', { cost: def.costStarsPerLevel })}<Star size={13} style={{verticalAlign:'middle',marginLeft:3}} /></>}
        </motion.button>
      )}
      {isMaxed && <div className="maxed-message">{t('shop.maxLevel')}</div>}
    </div>
  );
}

function StoryItemCard({ item, currentUniverse, onUseStoryItem, loadingStoryItemId }) {
  const StoryIcon = STORY_ITEM_ICONS[item.key] || ScrollText;
  const [selectedType, setSelectedType] = useState(item.selectedType || '');
  const isResonator = item.key === 'resonator_particle';
  const isOnCooldown = item.cooldownUntil ? new Date(item.cooldownUntil) > new Date() : false;
  const storyTypes = currentUniverse === 2
    ? ['echo', 'relic', 'entity', 'rift', 'asteroid']
    : ['debris', 'artifact', 'creature', 'anomaly'];

  useEffect(() => {
    if (isResonator) {
      setSelectedType(item.selectedType || storyTypes[0] || '');
    }
  }, [item.selectedType, isResonator, currentUniverse]);

  const cooldownText = isOnCooldown && item.cooldownUntil
    ? t('upgrades.rechargesAt', { time: new Date(item.cooldownUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
    : null;

  return (
    <div className="module-card buff-active">
      <div className="module-header">
        <span className="module-icon"><StoryIcon size={22} /></span>
        <div className="module-info">
          <span className="module-name">{isRu() ? item.nameRu : item.nameEn}</span>
          {item.selectedType && isResonator && (
            <span className="module-level">{t('upgrades.selectedType')}: {t(`findTypeSingle.${item.selectedType}`)}</span>
          )}
        </div>
      </div>
      <p className="module-stats current">{isRu() ? item.descRu : item.descEn}</p>
      {cooldownText && <p className="module-stats next">{cooldownText}</p>}
      {isResonator && (
        <div className="story-item-action-row">
          <select
            className="story-type-select"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
          >
            {storyTypes.map((type) => (
              <option key={type} value={type}>{t(`findTypeSingle.${type}`)}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onUseStoryItem?.(item.key, selectedType)}
            disabled={!selectedType || loadingStoryItemId === item.key}
          >
            {loadingStoryItemId === item.key ? <span className="spinner" /> : t('upgrades.apply')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function UpgradesPanel() {
  const { upgrades, loadUpgrades, upgradeModule, user, loading, activeBuffs, purchaseBuff, loadActiveBuffs, storyData, loadStory, useStoryItem } = useGameStore();
  const { haptic, showAlert, showConfirm } = useTelegram();
  const [buyingId, setBuyingId]           = useState(null);
  const [starUpgrades, setStarUpgrades]   = useState(null);
  const [buyingStarId, setBuyingStarId]   = useState(null);
  const [storyLoadingId, setStoryLoadingId] = useState(null);
  const [activeTab, setActiveTab]         = useState('bonuses');

  useEffect(() => {
    loadUpgrades();
    loadActiveBuffs();
    loadStory();
    upgradesApi.getStarUpgrades().then(r => setStarUpgrades(r.starUpgrades)).catch(() => {});
  }, []);

  const scannerLevel = upgrades?.scanner?.currentLevel ?? 1;

  const handleUpgrade = async (moduleType) => {
    const mod = upgrades?.[moduleType];
    if (!mod || mod.isMaxed) return;
    const moduleLabel = localizeModuleName(moduleType, mod.label);
    const costStr = mod.usesCrystals
      ? t('upgrades.crystalsCost', { n: mod.costCrystals })
      : t('upgrades.creditsCost', { n: mod.upgradeCost });
    const confirmed = await showConfirm(
      t('upgrades.upgradeModuleConfirm', { module: moduleLabel, level: mod.currentLevel + 1, cost: costStr })
    );
    if (!confirmed) return;
    haptic.impact('medium');
    try {
      await upgradeModule(moduleType);
      haptic.notification('success');
    } catch (err) {
      haptic.notification('error');
      let friendlyMessage = err.message;
      if (err.message?.includes('Crystal upgrades only available in Universe 2')) {
        friendlyMessage = t('upgrades.u2Only');
      } else if (err.message?.includes('Credit upgrades only available in Universe 1')) {
        friendlyMessage = t('upgrades.u1Only');
      }
      await showAlert(friendlyMessage);
    }
  };

  const handleBuy = async (itemId, payWith) => {
    const buffType = itemId.startsWith('signal_amplifier') ? 'signal_amplifier' : itemId;
    const existing = activeBuffs.find((b) => b.buff_type === buffType);
    if (existing) {
      const isTimeBased = !!existing.expires_at;
      const isUseBased = existing.uses_remaining != null;
      const isStackable = itemId === 'remote_scanner';
      if (!isStackable && (isTimeBased || isUseBased)) {
        let warningMsg;
        if (isTimeBased) {
          const mins = Math.max(1, Math.round((new Date(existing.expires_at) - Date.now()) / 60000));
          warningMsg = t('upgrades.buffActiveTimer', { mins });
        } else {
          warningMsg = t('upgrades.buffActiveUses', { uses: existing.uses_remaining });
        }
        const confirmed = await showConfirm(warningMsg);
        if (!confirmed) return;
      }
    }
    setBuyingId(itemId); haptic.impact('light');
    try {
      const result = await purchaseBuff(itemId, payWith);
      haptic.notification('success');
      await showAlert(t('shop.activated', { name: result.label || itemId }));
    } catch (err) {
      haptic.notification('error'); await showAlert(err.message || t('shop.purchaseError'));
    } finally { setBuyingId(null); }
  };

  const handleStarUpgrade = async (upgradeId) => {
    const def = starUpgrades?.[upgradeId];
    if (!def) return;
    const label = localizeStarUpgradeLabel(def);
    const confirmed = await showConfirm(
      t('upgrades.starUpgradeConfirm', { name: label, level: def.currentLevel + 1, cost: def.costStarsPerLevel })
    );
    if (!confirmed) return;
    setBuyingStarId(upgradeId); haptic.impact('medium');
    try {
      const res = await upgradesApi.purchaseStarUpgrade(upgradeId);
      haptic.notification('success');
      setStarUpgrades(prev => ({
        ...prev,
        [upgradeId]: { ...prev[upgradeId], currentLevel: res.newLevel, isMaxed: res.newLevel >= def.maxLevel }
      }));
      await showAlert(t('shop.upgradedTo', { level: res.newLevel }));
    } catch (err) {
      haptic.notification('error'); await showAlert(err.message || t('shop.purchaseError'));
    } finally { setBuyingStarId(null); }
  };

  const handleUseStoryItem = async (itemKey, selectedType) => {
    setStoryLoadingId(itemKey);
    haptic.impact('light');
    try {
      const result = await useStoryItem(itemKey, selectedType);
      if (result?.error) {
        haptic.notification('error');
        await showAlert(result.error);
        return;
      }
      haptic.notification('success');
      await showAlert(t('upgrades.storyItemActivated'));
    } catch (err) {
      haptic.notification('error');
      await showAlert(err.message || t('shop.purchaseError'));
    } finally {
      setStoryLoadingId(null);
    }
  };

  if (!upgrades) return <div className="center-spinner"><span className="spinner spinner-lg"/></div>;

  const STAR_UPGRADE_ORDER = ['pirate_suppressor','research_lab','gravity_stabilizer','advanced_scanner'];
  const shopTabs = [
    { id: 'bonuses', Icon: Gift,       label: t('shop.bonuses') },
    { id: 'upgrades', Icon: Rocket,    label: t('shop.shipUpgrades') },
    { id: 'story', Icon: ScrollText,   label: t('upgrades.tabStory') },
  ];

  return (
    <div className="upgrades-panel">
      <div className="panel-header shop-panel-header">
        <h2 className="section-title">{t('shop.title')}</h2>
        <StarsWallet hideBalance={true}/>
      </div>

      <div className="shop-tab-strip" role="tablist" aria-label={t('shop.title')}>
        {shopTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`shop-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="shop-tab-icon">{tab.Icon && <tab.Icon size={18} />}</span>
            <span className="shop-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="shop-tab-panel" role="tabpanel">
        {activeTab === 'bonuses' && (
          <>
            <div className="currency-section-hdr">
              <span className="currency-pill credits"><CoinIcon size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{t('shop.forCredits')}</span>
            </div>
            <div className="buff-items-list">
              {SHOP_ITEMS_CREDITS.map((item) => (
                <BuffItemCard key={item.id} item={item} payWith="credits"
                  onBuy={handleBuy} user={user} activeBuffs={activeBuffs} buyingId={buyingId}/>
              ))}
            </div>

            <div className="currency-section-hdr">
              <span className="currency-pill stars"><Star size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{t('shop.forStars')}</span>
            </div>
            <div className="buff-items-list">
              {SHOP_ITEMS_STARS.map((item) => (
                <BuffItemCard key={item.id} item={item} payWith="stars"
                  onBuy={handleBuy} user={user} activeBuffs={activeBuffs} buyingId={buyingId}/>
              ))}
            </div>
          </>
        )}

        {activeTab === 'upgrades' && (
          <>
            <div className="currency-section-hdr">
              <span className="currency-pill credits"><CoinIcon size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{t('shop.forCredits')}</span>
            </div>
            <div className="modules-list">
              {Object.entries(upgrades).map(([type, mod]) => (
                <ModuleCard key={type} type={type} mod={mod} onUpgrade={handleUpgrade} loading={loading.upgrade}/>
              ))}
            </div>

            <div className="currency-section-hdr">
              <span className="currency-pill stars"><Star size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{t('shop.forStars')}</span>
            </div>
            <div className="modules-list">
              {starUpgrades ? STAR_UPGRADE_ORDER.map((id) => {
                const def = starUpgrades[id];
                if (!def) return null;
                return (
                  <StarUpgradeCard
                    key={id} def={def}
                    onUpgrade={handleStarUpgrade}
                    buyingId={buyingStarId}
                    starsBalance={user?.starsBalance ?? 0}
                    scannerLevel={scannerLevel}
                  />
                );
              }) : (
                <div className="center-spinner"><span className="spinner"/></div>
              )}
            </div>
          </>
        )}

        {activeTab === 'story' && (
          <>
            <div className="currency-section-hdr">
              <span className="currency-pill story"><ScrollText size={13} style={{verticalAlign:'middle',marginRight:4}} />{t('upgrades.tabStory')}</span>
            </div>
            {storyData?.items?.length > 0 ? (
              <div className="modules-list">
                {storyData.items.map((item) => (
                  <StoryItemCard
                    key={item.key}
                    item={item}
                    currentUniverse={user?.currentUniverse || 1}
                    onUseStoryItem={handleUseStoryItem}
                    loadingStoryItemId={storyLoadingId}
                  />
                ))}
              </div>
            ) : (
              <div className="shop-empty-stars">
                {t('upgrades.noStoryItems')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
