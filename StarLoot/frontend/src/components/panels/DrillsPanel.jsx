import { useEffect, useMemo, useState, memo } from 'react';
import { motion, AnimatePresence } from '../../utils/safeMotion';
import { useGameStore } from '../../store/gameStore';
import { useTelegram } from '../../hooks/useTelegram';
import { t, isRu } from '../../i18n';
import { useAndroidWebView } from '../../utils/platform';
import Modal from '../ui/Modal';
import { Cog, RockIcon, CoinIcon, Dna, Package, Star, Pickaxe, FlaskConical, AsteroidIcon, Trash2, Check, DeepDrillIcon, DebrisIcon, ArtifactIcon, CreatureIcon, AnomalyIcon, EchoIcon, RiftIcon, GalaxyIcon, Atom, Award, Gift, Sparkles } from '../../icons';

const RARITY_COLORS = {
  common: 'var(--rarity-common)',
  rare: 'var(--rarity-rare)',
  epic: 'var(--rarity-epic)',
  legendary: 'var(--rarity-legendary)',
  mythical: 'var(--rarity-mythical)',
  exotic: 'var(--rarity-exotic)',
  ancient: 'var(--rarity-ancient)',
  relic: 'var(--rarity-relic)',
  hybrid: 'var(--rarity-hybrid)',
  singularity: 'var(--rarity-singularity)',
};

const RARITY_ORDER = {
  common: 1, rare: 2, exotic: 3, epic: 4, ancient: 5,
  legendary: 6, relic: 7, mythical: 8, hybrid: 9, singularity: 10,
};

const UPGRADE_CONFIG = [
  { key: 'yield',   labelKey: 'drills.upgYield',   Icon: Cog     },
  { key: 'fossil',  labelKey: 'drills.upgFossil',  Icon: RockIcon },
  { key: 'value',   labelKey: 'drills.upgValue',   Icon: CoinIcon },
  { key: 'storage', labelKey: 'drills.upgStorage', Icon: Package  },
];

const MAX_UPGRADE_LEVEL_BY_TYPE = {
  yield: 3, fossil: 5, value: 3, storage: 5,
};

function getDrillTypeIcon(drill) {
  const combined = ((drill?.name || '') + ' ' + (drill?.nameEn || '')).toLowerCase();
  if (/глубин|deep|core/.test(combined)) return DeepDrillIcon;
  if (/точн|precision|науч|science|research/.test(combined)) return Atom;
  return Pickaxe;
}

const FOSSIL_ICON_MAP = {
  iron_fragment: DebrisIcon, dust_crystal: ArtifactIcon, meteor_pebble: RockIcon,
  space_sediment: RockIcon, fossil_coral: CreatureIcon, ancient_shell: CreatureIcon,
  void_amber: AnomalyIcon, stellar_imprint: RiftIcon, crystal_bone: ArtifactIcon,
  nebula_pearl: EchoIcon, gravity_fossil: AnomalyIcon, chrono_shard: RiftIcon,
  plasma_fossil: AsteroidIcon, singularity_echo: GalaxyIcon,
};
function getFossilIcon(templateId) {
  return FOSSIL_ICON_MAP[templateId] || RockIcon;
}

const COLLECTION_ICON_FALLBACKS = [Award, Gift, Sparkles, ArtifactIcon, CreatureIcon, AnomalyIcon];
function getCollectionIcon(nameRu, nameEn, id) {
  const n = ((nameRu || '') + ' ' + (nameEn || '')).toLowerCase();
  if (/желез|металл|iron|metal|scrap/.test(n)) return DebrisIcon;
  if (/кристал|crystal|gem/.test(n)) return ArtifactIcon;
  if (/существ|creature|коралл|coral|раковин|shell|кость|bone/.test(n)) return CreatureIcon;
  if (/аномал|anomal|гравит|gravity/.test(n)) return AnomalyIcon;
  if (/эхо|echo|туманн|nebula|жемчуж|pearl/.test(n)) return EchoIcon;
  const hash = (id || n).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return COLLECTION_ICON_FALLBACKS[hash % COLLECTION_ICON_FALLBACKS.length];
}

function valuePerTonAfterUpgrades(baseValue, level) {
  let value = Math.max(1, Math.round(Number(baseValue || 1)));
  for (let i = 0; i < Number(level || 0); i++) {
    const boosted = Math.round(value * 1.1);
    value = boosted > value ? boosted : value + 1;
  }
  return value;
}

function buildUpgradeDeltaText(drill, key, level) {
  if (key === 'yield') {
    const current = Math.max(0, Math.round(Number(drill.yieldPerCycle || 0)));
    const next = current + 1;
    return `${current} -> ${next} t (+${next - current} t)`;
  }
  if (key === 'fossil') {
    const currentPct = Number(drill.fossilChance || 0) * 100;
    const nextPct = currentPct + 1;
    return `${currentPct.toFixed(2)}% -> ${nextPct.toFixed(2)}% (+${(nextPct - currentPct).toFixed(2)} ${t('drills.pp')})`;
  }
  if (key === 'storage') {
    const current = Math.max(0, Math.round(Number(drill.storageLimitCredits || drill.storageLimit || 0)));
    const next = current + 200;
    return `${Math.round(current)} -> ${Math.round(next)} (+${Math.round(next - current)})`;
  }
  if (key === 'value') {
    const asteroid = drill.assignedAsteroid;
    if (!asteroid) return t('drills.upgradeValueNoAsteroid');
    const current = Math.max(1, Math.round(Number(asteroid.valuePerTon || 1)));
    const base = Math.max(1, Math.round(Number(asteroid.baseValuePerTon || 1)));
    const next = valuePerTonAfterUpgrades(base, level + 1);
    return `${Math.round(current)} -> ${Math.round(next)}/t (+${Math.round(next - current)})`;
  }
  return t('drills.upgradeFallback');
}

function formatCooldownLeft(msLeft) {
  const safeMs = Math.max(0, Number(msLeft || 0));
  const totalSec = Math.ceil(safeMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${hours}${t('drills.hUnit')} ${String(minutes).padStart(2, '0')}${t('drills.mUnit')} ${String(seconds).padStart(2, '0')}${t('drills.sUnit')}`;
}

function DrillAccordion({ storeKey, title, icon, children, defaultOpen = false }) {
  const { shopAccordions, setShopAccordion } = useGameStore();
  const open = shopAccordions[storeKey] ?? defaultOpen;
  const toggle = () => setShopAccordion(storeKey, !open);
  return (
    <div className="shop-category">
      <button className="shop-category-header" onClick={toggle}>
        <span>{icon} {title}</span>
        <span className="shop-category-arrow">{open ? '▲' : '▼'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="shop-category-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const DrillCard = memo(function DrillCard({ slotIndex, drill, onCollect, onDelete, onOpenAsteroidPicker, collecting, deleting }) {
  const ru = isRu();
  const fillPct = Math.min(100, Math.round((drill.balance / Math.max(1, drill.storageLimit)) * 100));
  const asteroid = drill.assignedAsteroid;
  const isFull = Boolean(drill.isFull);
  const DrillIcon = getDrillTypeIcon(drill);

  return (
    <div className={`drill-card${isFull ? ' storage-full' : ''}`}>
      <div className="drill-card-top">
        <div className={`drill-icon-wrap${isFull ? ' full' : ''}`}>
          <span className="drill-icon"><DrillIcon size={22} /></span>
        </div>
        <div className="drill-info">
          <div className="drill-name">{ru ? drill.name : drill.nameEn || drill.name}</div>
          <div className="drill-card-meta">
            <span className="pill pill-slot">{t('drills.slot', { n: slotIndex })}</span>
            {isFull && <span className="pill pill-full">FULL</span>}
          </div>
        </div>
      </div>

      {isFull && (
        <div className="warn-text">{t('drills.storageFull')}</div>
      )}

      <div className="drill-storage">
        <div className="drill-storage-bar">
          <div className={`drill-storage-fill${drill.isFull ? ' full' : ''}`} style={{ width: `${fillPct}%` }} />
        </div>
        <div className="drill-storage-label">
          {drill.balanceCredits || drill.balance || 0} / {drill.storageLimitCredits || drill.storageLimit || 0} <CoinIcon size={11} style={{verticalAlign:'middle'}} />
        </div>
      </div>

      <div className="drill-stats-row">
        <span>+{drill.yieldPerCycle} t / {Math.round(drill.cycleDurationSec / 60)}{t('drills.mUnit')}</span>
        <span>{t('drills.fossilsLabel')}: {(drill.fossilChance * 100).toFixed(1)}%</span>
      </div>

      <button className="drill-target-trigger" onClick={() => onOpenAsteroidPicker(drill)}>
        {asteroid ? (
          <>
            <div className="drill-asteroid-label">
              {t('drills.target')}: {ru ? asteroid.name : (asteroid.nameEn || asteroid.name)}
            </div>
            <div className="drill-asteroid-meta">
              {asteroid.resourceName} · {(asteroid.remainingVolume).toFixed(3).replace(/\.?0+$/, '')} / {(asteroid.totalVolume).toFixed(3).replace(/\.?0+$/, '')} t · {asteroid.valuePerTon} <CoinIcon size={11} style={{verticalAlign:'middle'}} /> / t
            </div>
            {!asteroid.canReassign && (
              <div className="asteroid-lock-note">{t('drills.targetLocked')}</div>
            )}
          </>
        ) : (
          <div className="drill-asteroid-label">{t('drills.selectTarget')}</div>
        )}
      </button>

      <div className="drill-actions">
        <button
          className="btn btn-primary btn-sm drill-collect-btn"
          onClick={() => onCollect(drill.id)}
          disabled={collecting || drill.balance <= 0}
        >
          {collecting ? <span className="spinner" /> : t('drills.collect')}
        </button>
        <button className="btn btn-danger btn-xs drill-delete-btn" onClick={() => onDelete(drill.id)} disabled={deleting}>
          {deleting ? '...' : <Trash2 size={14} />}
        </button>
      </div>
    </div>
  );
});

const SlotPurchaseCard = memo(function SlotPurchaseCard({ slotIndex, availableTypes, onBuy, buyingId }) {
  const ru = isRu();
  return (
    <div className="drill-card drill-slot-empty-card">
      <div className="drill-slot-title">{t('drills.slotNum', { n: slotIndex })}</div>
      <div className="drill-slot-subtitle drill-slot-purchase-label">{t('drills.chooseDrill')}</div>
      <div className="drill-slot-type-grid">
        {availableTypes.map((drillType) => {
          const CostIcon = drillType.costStars ? Star : CoinIcon;
          const costLabel = drillType.costStars ? drillType.costStars : (drillType.costCredits || 0);
          const payWith = drillType.costStars ? 'stars' : 'credits';
          const costClass = drillType.costStars ? 'cost-stars' : (Number(drillType.costCredits || 0) > 0 ? 'cost-credits' : 'cost-free');
          const isBuying = buyingId === `${slotIndex}_${drillType.id}`;
          return (
            <button
              key={`${slotIndex}_${drillType.id}`}
              className="drill-slot-type-btn drill-type-card"
              onClick={() => onBuy(drillType.id, payWith, slotIndex)}
              disabled={isBuying}
            >
              {(() => { const DI = getDrillTypeIcon(drillType); return <span className="drill-type-card-icon"><DI size={24} /></span>; })()}
              <span className="drill-type-name">{ru ? drillType.name : (drillType.nameEn || drillType.name)}</span>
              <span className="drill-type-stats">
                {`${drillType.yieldPerCycle || 0} t/${t('drills.cycle')} · ${Math.round((drillType.cycleDurationSec || 0) / 60)} ${t('drills.mUnit')}`}
              </span>
              <span className={`drill-type-cost ${costClass}`}>{isBuying ? '...' : <><CostIcon size={12} style={{verticalAlign:'middle',marginRight:2}} />{costLabel}</>}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

const SlotLockedCard = memo(function SlotLockedCard({ slotIndex, canUnlock, unlockCost, onUnlock, unlocking }) {
  return (
    <div className="drill-card drill-slot-locked-card">
      <div className="drill-slot-title">{t('drills.slotNum', { n: slotIndex })}</div>
      <div className="drill-slot-subtitle">
        {canUnlock ? t('drills.unlockSlotLabel', { cost: unlockCost }) : t('drills.fillPrevSlot')}
      </div>
      {canUnlock && (
        <button className="btn btn-primary btn-sm" onClick={onUnlock} disabled={unlocking}>
          {unlocking ? <span className="spinner" /> : <><Star size={12} style={{verticalAlign:'middle',marginRight:3}} />{unlockCost} Stars</>}
        </button>
      )}
    </div>
  );
});

const DrillUpgradeCard = memo(function DrillUpgradeCard({ drill, onUpgrade, upgrading }) {
  const ru = isRu();
  const upgrades = drill.upgrades || { totalUsed: 0, maxTotal: 5, nextCost: null, canUpgrade: false };
  const totalSlots = Number(upgrades.maxTotal || 5);
  const usedSlots = Number(upgrades.totalUsed || 0);
  const DrillUpgIcon = getDrillTypeIcon(drill);

  return (
    <div className="drill-card drill-upgrade-card">
      <div className="drill-card-header">
        <span className="drill-icon"><DrillUpgIcon size={22} /></span>
        <div className="drill-info">
          <div className="drill-name">{ru ? drill.name : drill.nameEn || drill.name}</div>
          <div className="drill-level">
            {t('drills.slotNum', { n: drill.slotIndex })} · {t('drills.used')}: {upgrades.totalUsed}/{upgrades.maxTotal}
          </div>
        </div>
      </div>

      <div className="drill-upgrade-pips-row">
        <span className="drill-upgrade-pips-label">{t('drills.upgradesUsed')}</span>
        <div className="drill-upgrade-pips">
          {Array.from({ length: totalSlots }, (_, idx) => (
            <span key={`used_${drill.id}_${idx}`} className={`drill-upgrade-pip${idx < usedSlots ? ' on' : ''}`} />
          ))}
        </div>
      </div>

      <div className="drill-upgrade-list">
        {UPGRADE_CONFIG.map((cfg) => {
          const lvl = Number(drill.upgrades?.[`${cfg.key}Level`] || 0);
          const typeMaxLevel = MAX_UPGRADE_LEVEL_BY_TYPE[cfg.key] || 3;
          const deltaText = buildUpgradeDeltaText(drill, cfg.key, lvl);
          return (
            <div key={cfg.key} className="drill-upgrade-row">
              <div>
                <div className="drill-upgrade-name">{cfg.Icon && <cfg.Icon size={14} style={{verticalAlign:'middle',marginRight:4}} />}{t(cfg.labelKey)}</div>
                <div className="drill-upgrade-meta">{deltaText}</div>
              </div>
              <div className="drill-upgrade-dots" aria-hidden="true">
                {Array.from({ length: typeMaxLevel }, (_, idx) => (
                  <span key={`${drill.id}_${cfg.key}_${idx}`} className={`drill-upgrade-dot${idx < lvl ? ' on' : ''}`} />
                ))}
              </div>
              <button
                className="btn btn-xs drill-upgrade-buy-btn"
                onClick={() => onUpgrade(drill.id, cfg.key, upgrades.nextCost)}
                disabled={upgrading || !upgrades.canUpgrade || lvl >= typeMaxLevel}
              >
                {upgrading ? <span className="spinner" /> : <><CoinIcon size={11} style={{verticalAlign:'middle',marginRight:2}} />{upgrades.nextCost || 0}</>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const CollectibleItem = memo(function CollectibleItem({ item, onSell, selling }) {
  const ru = isRu();
  const FossilIcon = getFossilIcon(item.templateId);
  return (
    <div className="collectible-item" style={{ borderColor: RARITY_COLORS[item.rarity] || RARITY_COLORS.common }}>
      <div className="collectible-icon"><FossilIcon size={24} /></div>
      <div className="collectible-name">{ru ? item.name : (item.nameEn || item.name)}</div>
      <div className="collectible-rarity" style={{ color: RARITY_COLORS[item.rarity] }}>{t(`rarity.${item.rarity}`)}</div>
      <button className="btn btn-sell btn-xs" onClick={() => onSell(item.id)} disabled={selling}>
        {selling ? '...' : <><CoinIcon size={11} style={{verticalAlign:'middle',marginRight:2}} />{item.sellPrice}</>}
      </button>
    </div>
  );
});

const CollectionCard = memo(function CollectionCard({ collection, collectibleNames, onSubmit, submitting, nowMs }) {
  const ru = isRu();
  const allMet = collection.items.every((i) => i.owned >= i.required);
  const nextAvailableAtMs = collection.nextAvailableAt ? new Date(collection.nextAvailableAt).getTime() : null;
  const onCooldown = Boolean(nextAvailableAtMs && nextAvailableAtMs > nowMs);
  const cooldownLeft = onCooldown ? formatCooldownLeft(nextAvailableAtMs - nowMs) : null;
  const CollIcon = getCollectionIcon(collection.name, collection.nameEn, collection.id);

  return (
    <div className={`collection-card${onCooldown ? ' completed' : ''}`}>
      <div className="collection-header">
        <span className="collection-icon"><CollIcon size={20} /></span>
        <div>
          <div className="collection-name">
            {ru ? collection.name : (collection.nameEn || collection.name)}
            {onCooldown && <Check size={13} style={{verticalAlign:'middle',marginLeft:4}} />}
          </div>
          <div className="collection-reward">
            {collection.rewardCredits > 0 && <span>{collection.rewardCredits} <CoinIcon size={11} style={{verticalAlign:'middle'}} /></span>}
            {collection.rewardXp > 0 && <span> +{collection.rewardXp} XP</span>}
          </div>
          {onCooldown && (
            <div className="drill-upgrade-meta">{t('drills.availableIn', { time: cooldownLeft })}</div>
          )}
        </div>
      </div>
      <div className="collection-items">
        {collection.items.map((item) => {
          const cName = collectibleNames[item.collectibleId]
            || (ru ? item.collectibleName : (item.collectibleNameEn || item.collectibleName));
          return (
            <div key={item.collectibleId} className={`collection-req${item.owned >= item.required ? ' met' : ''}`}>
              <span className="collection-req-name">{cName || item.collectibleId}</span>
              <span className="collection-req-count">{item.owned}/{item.required}</span>
            </div>
          );
        })}
      </div>
      <button
        className="btn btn-primary btn-sm"
        onClick={() => onSubmit(collection.id)}
        disabled={!allMet || submitting || onCooldown}
        style={{ marginTop: 8, width: '100%' }}
      >
        {submitting ? <span className="spinner" /> : t('drills.submitCollection')}
      </button>
    </div>
  );
});

const AndroidDrillCard = memo(function AndroidDrillCard({ slotIndex, drill, onCollect, onDelete, onOpenAsteroidPicker, collecting, deleting }) {
  const ru = isRu();
  const fillPct = Math.min(100, Math.round((Number(drill.balance || 0) / Math.max(1, Number(drill.storageLimit || 1))) * 100));
  const asteroid = drill.assignedAsteroid;
  const isFull = Boolean(drill.isFull);
  const DrillIcon = getDrillTypeIcon(drill);

  return (
    <div className={`android-drill-card${isFull ? ' android-drill-card--full' : ''}`}>
      <div className="android-drill-head">
        <span className="android-drill-iconbox"><DrillIcon size={22} /></span>
        <div className="android-drill-head-text">
          <div className="android-drill-title">{ru ? drill.name : drill.nameEn || drill.name}</div>
          <div className="android-drill-subtitle">
            {t('drills.slot', { n: slotIndex })}{isFull ? ' · FULL' : ''}
          </div>
        </div>
      </div>

      {isFull && <div className="android-drill-warn">{t('drills.storageFull')}</div>}

      <div className="android-drill-meter">
        <span style={{ width: `${fillPct}%` }} />
      </div>
      <div className="android-drill-line">
        <span>{drill.balanceCredits || drill.balance || 0} / {drill.storageLimitCredits || drill.storageLimit || 0}</span>
        <span>+{drill.yieldPerCycle} t / {Math.round(drill.cycleDurationSec / 60)}{t('drills.mUnit')}</span>
      </div>
      <div className="android-drill-line android-drill-line--muted">
        <span>{t('drills.fossilsLabel')}</span>
        <span>{(Number(drill.fossilChance || 0) * 100).toFixed(1)}%</span>
      </div>

      <button className="android-drill-target" onClick={() => onOpenAsteroidPicker(drill)}>
        {asteroid ? (
          <>
            <span>{t('drills.target')}: {ru ? asteroid.name : (asteroid.nameEn || asteroid.name)}</span>
            <small>
              {asteroid.resourceName} · {(asteroid.remainingVolume).toFixed(3).replace(/\.?0+$/, '')} / {(asteroid.totalVolume).toFixed(3).replace(/\.?0+$/, '')} t · {asteroid.valuePerTon}
            </small>
            {!asteroid.canReassign && (
              <small>{t('drills.targetLocked')}</small>
            )}
          </>
        ) : (
          <span>{t('drills.selectTarget')}</span>
        )}
      </button>

      <div className="android-drill-actions">
        <button
          className="android-drill-btn android-drill-btn--primary"
          onClick={() => onCollect(drill.id)}
          disabled={collecting || Number(drill.balance || 0) <= 0}
        >
          {collecting ? '...' : t('drills.collect')}
        </button>
        <button
          className="android-drill-btn android-drill-btn--danger"
          onClick={() => onDelete(drill.id)}
          disabled={deleting}
          aria-label={t('drills.ariaDelete')}
        >
          {deleting ? '...' : <Trash2 size={15} />}
        </button>
      </div>
    </div>
  );
});

const AndroidSlotPurchaseCard = memo(function AndroidSlotPurchaseCard({ slotIndex, availableTypes, onBuy, buyingId }) {
  const ru = isRu();
  return (
    <div className="android-drill-card android-drill-card--new">
      <div className="android-drill-title">{t('drills.slotNum', { n: slotIndex })}</div>
      <div className="android-drill-subtitle">{t('drills.chooseDrillShort')}</div>
      <div className="android-drill-type-grid">
        {availableTypes.map((drillType) => {
          const CostIcon = drillType.costStars ? Star : CoinIcon;
          const costLabel = drillType.costStars ? drillType.costStars : (drillType.costCredits || 0);
          const payWith = drillType.costStars ? 'stars' : 'credits';
          const isBuying = buyingId === `${slotIndex}_${drillType.id}`;
          const TypeIcon = getDrillTypeIcon(drillType);
          return (
            <button
              key={`${slotIndex}_${drillType.id}`}
              className="android-drill-type-btn"
              onClick={() => onBuy(drillType.id, payWith, slotIndex)}
              disabled={isBuying}
            >
              <span className="android-drill-iconbox"><TypeIcon size={20} /></span>
              <span className="android-drill-type-text">
                <strong>{ru ? drillType.name : (drillType.nameEn || drillType.name)}</strong>
                <small>{`${drillType.yieldPerCycle || 0} t/${t('drills.cycle')} · ${Math.round((drillType.cycleDurationSec || 0) / 60)} ${t('drills.mUnit')}`}</small>
              </span>
              <span className="android-drill-price"><CostIcon size={12} />{isBuying ? '...' : costLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

const AndroidSlotLockedCard = memo(function AndroidSlotLockedCard({ slotIndex, canUnlock, unlockCost, onUnlock, unlocking }) {
  return (
    <div className="android-drill-card android-drill-card--locked">
      <div className="android-drill-title">{t('drills.slotNum', { n: slotIndex })}</div>
      <div className="android-drill-subtitle">
        {canUnlock ? t('drills.unlockSlotLabel', { cost: unlockCost }) : t('drills.fillPrevSlot')}
      </div>
      {canUnlock && (
        <button className="android-drill-btn android-drill-btn--primary" onClick={onUnlock} disabled={unlocking}>
          {unlocking ? '...' : <><Star size={13} />{unlockCost} Stars</>}
        </button>
      )}
    </div>
  );
});

const AndroidDrillUpgradeCard = memo(function AndroidDrillUpgradeCard({ drill, onUpgrade, upgrading }) {
  const ru = isRu();
  const upgrades = drill.upgrades || { totalUsed: 0, maxTotal: 5, nextCost: null, canUpgrade: false };
  const totalSlots = Number(upgrades.maxTotal || 5);
  const usedSlots = Number(upgrades.totalUsed || 0);
  const DrillUpgIcon = getDrillTypeIcon(drill);

  return (
    <div className="android-drill-card android-drill-card--upgrade">
      <div className="android-drill-head">
        <span className="android-drill-iconbox"><DrillUpgIcon size={22} /></span>
        <div className="android-drill-head-text">
          <div className="android-drill-title">{ru ? drill.name : drill.nameEn || drill.name}</div>
          <div className="android-drill-subtitle">
            {t('drills.slotNum', { n: drill.slotIndex })} · {t('drills.used')}: {usedSlots}/{totalSlots}
          </div>
        </div>
      </div>
      <div className="android-drill-pips" aria-hidden="true">
        {Array.from({ length: totalSlots }, (_, idx) => (
          <span key={`android_used_${drill.id}_${idx}`} className={idx < usedSlots ? 'on' : ''} />
        ))}
      </div>
      <div className="android-drill-upgrade-list">
        {UPGRADE_CONFIG.map((cfg) => {
          const lvl = Number(drill.upgrades?.[`${cfg.key}Level`] || 0);
          const typeMaxLevel = MAX_UPGRADE_LEVEL_BY_TYPE[cfg.key] || 3;
          const deltaText = buildUpgradeDeltaText(drill, cfg.key, lvl);
          return (
            <div key={cfg.key} className="android-drill-upgrade-row">
              <div className="android-drill-upgrade-text">
                <strong>{cfg.Icon && <cfg.Icon size={14} />}{t(cfg.labelKey)}</strong>
                <small>{deltaText}</small>
              </div>
              <div className="android-drill-dots" aria-hidden="true">
                {Array.from({ length: typeMaxLevel }, (_, idx) => (
                  <span key={`android_${drill.id}_${cfg.key}_${idx}`} className={idx < lvl ? 'on' : ''} />
                ))}
              </div>
              <button
                className="android-drill-btn android-drill-btn--small"
                onClick={() => onUpgrade(drill.id, cfg.key, upgrades.nextCost)}
                disabled={upgrading || !upgrades.canUpgrade || lvl >= typeMaxLevel}
              >
                {upgrading ? '...' : <><CoinIcon size={11} />{upgrades.nextCost || 0}</>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const AndroidCollectibleItem = memo(function AndroidCollectibleItem({ item, onSell, selling }) {
  const ru = isRu();
  const FossilIcon = getFossilIcon(item.templateId);
  const rarityColor = RARITY_COLORS[item.rarity] || RARITY_COLORS.common;
  return (
    <div className="android-fossil-card" style={{ borderLeftColor: rarityColor }}>
      <span className="android-drill-iconbox"><FossilIcon size={20} /></span>
      <div className="android-fossil-info">
        <strong>{ru ? item.name : (item.nameEn || item.name)}</strong>
        <small style={{ color: rarityColor }}>{t(`rarity.${item.rarity}`)}</small>
      </div>
      <button className="android-drill-btn android-drill-btn--small" onClick={() => onSell(item.id)} disabled={selling}>
        {selling ? '...' : <><CoinIcon size={11} />{item.sellPrice}</>}
      </button>
    </div>
  );
});

const AndroidCollectionCard = memo(function AndroidCollectionCard({ collection, collectibleNames, onSubmit, submitting, nowMs }) {
  const ru = isRu();
  const allMet = collection.items.every((i) => i.owned >= i.required);
  const nextAvailableAtMs = collection.nextAvailableAt ? new Date(collection.nextAvailableAt).getTime() : null;
  const onCooldown = Boolean(nextAvailableAtMs && nextAvailableAtMs > nowMs);
  const cooldownLeft = onCooldown ? formatCooldownLeft(nextAvailableAtMs - nowMs) : null;
  const CollIcon = getCollectionIcon(collection.name, collection.nameEn, collection.id);

  return (
    <div className={`android-collection-card${onCooldown ? ' android-collection-card--done' : ''}`}>
      <div className="android-drill-head">
        <span className="android-drill-iconbox"><CollIcon size={20} /></span>
        <div className="android-drill-head-text">
          <div className="android-drill-title">
            {ru ? collection.name : (collection.nameEn || collection.name)}
            {onCooldown && <Check size={13} style={{ verticalAlign: 'middle', marginLeft: 4 }} />}
          </div>
          <div className="android-drill-subtitle">
            {collection.rewardCredits > 0 && <span>{collection.rewardCredits} credits</span>}
            {collection.rewardXp > 0 && <span> · {collection.rewardXp} XP</span>}
          </div>
          {onCooldown && (
            <div className="android-drill-subtitle">{t('drills.availableIn', { time: cooldownLeft })}</div>
          )}
        </div>
      </div>
      <div className="android-collection-reqs">
        {collection.items.map((item) => {
          const cName = collectibleNames[item.collectibleId]
            || (ru ? item.collectibleName : (item.collectibleNameEn || item.collectibleName));
          const met = item.owned >= item.required;
          return (
            <div key={item.collectibleId} className={`android-collection-req${met ? ' met' : ''}`}>
              <span>{cName || item.collectibleId}</span>
              <strong>{item.owned}/{item.required}</strong>
            </div>
          );
        })}
      </div>
      <button
        className="android-drill-btn android-drill-btn--primary"
        onClick={() => onSubmit(collection.id)}
        disabled={!allMet || submitting || onCooldown}
      >
        {submitting ? '...' : t('drills.submitCollection')}
      </button>
    </div>
  );
});

function AsteroidPickerModal({ visible, drill, asteroids, onClose, onAssign, assigningId }) {
  const ru = isRu();
  const [sortBy, setSortBy] = useState('rarity');
  const [selectedId, setSelectedId] = useState(null);
  const [previewAsteroidId, setPreviewAsteroidId] = useState(null);

  useEffect(() => {
    if (!visible) {
      setSelectedId(null);
      setPreviewAsteroidId(null);
      setSortBy('rarity');
    }
  }, [visible]);

  const sortedAsteroids = useMemo(() => {
    const arr = [...asteroids];
    arr.sort((a, b) => {
      if (sortBy === 'rarity') {
        const aRank = a.scanned === false ? -1 : (RARITY_ORDER[a.rarity] || 0);
        const bRank = b.scanned === false ? -1 : (RARITY_ORDER[b.rarity] || 0);
        return bRank - aRank;
      }
      if (sortBy === 'date') return new Date(b.acquiredAt || 0).getTime() - new Date(a.acquiredAt || 0).getTime();
      if (sortBy === 'price') return Number(b.sellPrice || 0) - Number(a.sellPrice || 0);
      return 0;
    });
    return arr;
  }, [asteroids, sortBy]);

  const previewAsteroid = sortedAsteroids.find((a) => a.id === previewAsteroidId) || null;

  return (
    <>
      <Modal open={visible} onClose={onClose} title={t('drills.pickerTitle')} className="drill-picker-modal-shell">
        <div className="qa-item-modal-info drill-picker-info">
          <span>{t('drills.slotNum', { n: drill?.slotIndex })}: {ru ? drill?.name : (drill?.nameEn || drill?.name)}</span>
          <select className="asteroid-sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="rarity">{t('drills.sortRarity')}</option>
            <option value="date">{t('drills.sortDate')}</option>
            <option value="price">{t('drills.sortPrice')}</option>
          </select>
        </div>

        <div className="qa-item-list drill-picker-list">
          {sortedAsteroids.length === 0 && (
            <div className="qa-empty">{t('drills.noAsteroids')}</div>
          )}
          {sortedAsteroids.map((asteroid) =>
            (() => {
              const isUnknown = asteroid.scanned === false;
              const rarityLabel = isUnknown ? t('findResult.unknown') : t(`rarity.${asteroid.rarity}`);
              return (
                <button
                  key={asteroid.id}
                  className={`qa-item-row drill-picker-item ${selectedId === asteroid.id ? 'selected' : ''}`}
                  onClick={() => { setSelectedId(asteroid.id); setPreviewAsteroidId(asteroid.id); }}
                >
                  <span><AsteroidIcon size={18} /></span>
                  <span className="drill-picker-item-name">
                    {isUnknown ? t('drills.unknownAsteroid') : (ru ? asteroid.name : (asteroid.nameEn || asteroid.name))}
                  </span>
                  <span className="qa-item-rarity" style={{ color: isUnknown ? 'var(--text-muted)' : (RARITY_COLORS[asteroid.rarity] || RARITY_COLORS.common) }}>
                    {rarityLabel}
                  </span>
                </button>
              );
            })()
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(previewAsteroid)}
        onClose={() => setPreviewAsteroidId(null)}
        title={
          previewAsteroid
            ? (previewAsteroid.scanned === false
              ? t('drills.unknownAsteroid')
              : (ru ? previewAsteroid.name : (previewAsteroid.nameEn || previewAsteroid.name)))
            : ''
        }
        className="item-detail-modal"
      >
        {previewAsteroid && (() => {
          const isUnknown = previewAsteroid.scanned === false;
          const rarityColor = isUnknown ? 'var(--text-muted)' : (RARITY_COLORS[previewAsteroid.rarity] || RARITY_COLORS.common);
          return (
            <>
              <div className="idm-header" style={{ '--rarity-color': rarityColor }}>
                <span className="idm-type-icon"><AsteroidIcon size={32} /></span>
                <div className="idm-meta">
                  <span className="idm-type-label">{t('drills.asteroidType')}</span>
                  <span className="idm-rarity" style={{ color: rarityColor }}>
                    {isUnknown ? t('findResult.unknown') : t(`rarity.${previewAsteroid.rarity}`)}
                  </span>
                </div>
              </div>

              <div className="idm-rows">
                <div className="detail-row">
                  <span className="detail-label">{t('inventory.resource')}</span>
                  <span className="detail-value" style={isUnknown ? { color: 'var(--text-muted)', fontStyle: 'italic' } : {}}>
                    {isUnknown ? t('findResult.unknown') : previewAsteroid.resourceName}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">{t('findResult.volume')}</span>
                  <span className="detail-value" style={isUnknown ? { color: 'var(--text-muted)', fontStyle: 'italic' } : {}}>
                    {isUnknown ? t('findResult.unknown') : `${(previewAsteroid.remainingVolume).toFixed(3).replace(/\.?0+$/, '')} / ${(previewAsteroid.totalVolume).toFixed(3).replace(/\.?0+$/, '')} t`}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">{t('findResult.condition')}</span>
                  <span className="detail-value" style={isUnknown ? { color: 'var(--text-muted)', fontStyle: 'italic' } : {}}>
                    {isUnknown ? t('findResult.unknown') : `${Number(previewAsteroid.condition || 0).toFixed(1)}%`}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">{t('drills.upgValue')}</span>
                  <span className="detail-value">
                    {isUnknown ? t('findResult.unknown') : <>{previewAsteroid.valuePerTon} <CoinIcon size={11} style={{verticalAlign:'middle'}} /></>}
                  </span>
                </div>
              </div>

              <div className="idm-actions">
                <button
                  className="btn btn-primary"
                  onClick={async () => { await onAssign(previewAsteroid.id); setPreviewAsteroidId(null); }}
                  disabled={assigningId === previewAsteroid.id}
                >
                  {assigningId === previewAsteroid.id ? <span className="spinner" /> : t('drills.use')}
                </button>
                <button className="btn btn-secondary" onClick={() => setPreviewAsteroidId(null)}>
                  {t('common.close')}
                </button>
              </div>
            </>
          );
        })()}
      </Modal>
    </>
  );
}

export default function DrillsPanel() {
  const drillData = useGameStore((s) => s.drillData);
  const loadDrills = useGameStore((s) => s.loadDrills);
  const collectDrill = useGameStore((s) => s.collectDrill);
  const assignDrillAsteroid = useGameStore((s) => s.assignDrillAsteroid);
  const purchaseDrill = useGameStore((s) => s.purchaseDrill);
  const unlockDrillSlot = useGameStore((s) => s.unlockDrillSlot);
  const upgradeDrill = useGameStore((s) => s.upgradeDrill);
  const deleteDrill = useGameStore((s) => s.deleteDrill);
  const sellCollectible = useGameStore((s) => s.sellCollectible);
  const submitCollection = useGameStore((s) => s.submitCollection);

  const [activeTab, setActiveTab] = useState('drills');
  const [collectingId, setCollectingId] = useState(null);
  const [upgradingId, setUpgradingId] = useState(null);
  const [buyingId, setBuyingId] = useState(null);
  const [unlockingSlot, setUnlockingSlot] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleteCountdown, setDeleteCountdown] = useState(0);
  const [sellingId, setSellingId] = useState(null);
  const [submittingId, setSubmittingId] = useState(null);
  const [assigningId, setAssigningId] = useState(null);
  const [pickerDrill, setPickerDrill] = useState(null);
  const [toast, setToast] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const { haptic, showConfirm } = useTelegram();
  const ru = isRu();
  const androidWebView = useAndroidWebView();

  useEffect(() => {
    loadDrills();
    const interval = setInterval(loadDrills, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!confirmDeleteId) return;
    let count = 5;
    setDeleteCountdown(count);
    const tick = setInterval(() => {
      count -= 1;
      setDeleteCountdown(count);
      if (count <= 0) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [confirmDeleteId]);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  };

  const handleCollect = async (drillId) => {
    setCollectingId(drillId);
    haptic?.impact('light');
    const result = await collectDrill(drillId);
    setCollectingId(null);
    if (result?.error) {
      await loadDrills();
      if ((result.error || '').toLowerCase().includes('internal server error')) {
        return showToast(t('drills.collectFailRetry'), 'err');
      }
      return showToast(result.error, 'err');
    }
    showToast(
      <span>
        <CoinIcon size={12} style={{verticalAlign:'middle',marginRight:3}} />+{result.creditsCollected}
        {result.tonsCollected != null && ` · ${result.tonsCollected} t`}
        {result.fossilsFound?.length > 0 && t('drills.fossilsCount', { n: result.fossilsFound.length })}
        {result.exhausted && t('drills.asteroidExhausted')}
      </span>
    );
  };

  const openAsteroidPicker = (drill) => {
    if (drill.assignedAsteroid && !drill.assignedAsteroid.canReassign) {
      showToast(t('drills.targetLockMsg'));
      return;
    }
    setPickerDrill(drill);
  };

  const handleAssignAsteroid = async (asteroidId) => {
    if (!pickerDrill?.id || !asteroidId) return;
    const ok = await showConfirm(t('drills.assignConfirm'));
    if (!ok) return;
    setAssigningId(asteroidId);
    haptic?.impact('medium');
    const result = await assignDrillAsteroid(pickerDrill.id, asteroidId);
    setAssigningId(null);
    if (result?.error) return showToast(result.error, 'err');
    setPickerDrill(null);
    showToast(t('drills.assigned'));
  };

  const handleUpgrade = async (drillId, upgradeType, cost) => {
    const cfg = UPGRADE_CONFIG.find((c) => c.key === upgradeType);
    const ok = await showConfirm(t('drills.upgradeConfirm', { name: t(cfg?.labelKey || upgradeType), cost }));
    if (!ok) return;
    setUpgradingId(drillId);
    haptic?.impact('medium');
    const result = await upgradeDrill(drillId, upgradeType);
    setUpgradingId(null);
    if (result?.error) return showToast(result.error, 'err');
    showToast(t('drills.upgradeApplied'));
  };

  const handleBuy = async (drillTypeId, payWith, slotIndex) => {
    setBuyingId(`${slotIndex}_${drillTypeId}`);
    haptic?.impact('light');
    const result = await purchaseDrill(drillTypeId, payWith, slotIndex);
    setBuyingId(null);
    if (result?.error) return showToast(result.error, 'err');
    showToast(t('drills.drillInstalled', { n: slotIndex }));
  };

  const handleUnlockSlot = async () => {
    const ok = await showConfirm(t('drills.unlockSlotConfirm', { cost: slotUnlockCostStars }));
    if (!ok) return;
    setUnlockingSlot(true);
    const result = await unlockDrillSlot();
    setUnlockingSlot(false);
    if (result?.error) {
      const raw = String(result.error || '');
      const generic400 = /status code 400/i.test(raw) || /^error$/i.test(raw.trim());
      if (generic400 && Number(starsBalance || 0) < Number(slotUnlockCostStars || 0)) {
        return showToast(t('drills.notEnoughStars', { have: starsBalance, need: slotUnlockCostStars }), 'err');
      }
      return showToast(result.error, 'err');
    }
    showToast(t('drills.slotUnlocked', { n: result.unlockedSlots }));
  };

  const handleDeleteDrill = async (drillId) => {
    const ok = await showConfirm(t('drills.deleteDialogConfirm'));
    if (!ok) return;
    setConfirmDeleteId(drillId);
  };

  const handleConfirmDelete = async () => {
    const drillId = confirmDeleteId;
    setConfirmDeleteId(null);
    setDeleteCountdown(0);
    setDeletingId(drillId);
    const result = await deleteDrill(drillId);
    setDeletingId(null);
    if (result?.error) return showToast(result.error, 'err');
    showToast(t('drills.drillDeleted'));
  };

  const handleSell = async (itemId) => {
    setSellingId(itemId);
    const result = await sellCollectible(itemId);
    setSellingId(null);
    if (result?.error) return showToast(result.error, 'err');
    showToast(<span><CoinIcon size={12} style={{verticalAlign:'middle',marginRight:3}} />+{result.creditsGained}</span>);
  };

  const handleSubmit = async (collectionId) => {
    const ok = await showConfirm(t('drills.submitConfirm'));
    if (!ok) return;
    setSubmittingId(collectionId);
    haptic?.impact('heavy');
    const result = await submitCollection(collectionId);
    setSubmittingId(null);
    if (result?.error) return showToast(result.error, 'err');
    showToast(<span><CoinIcon size={12} style={{verticalAlign:'middle',marginRight:3}} />+{result.rewardCredits}{' · '}<Dna size={12} style={{verticalAlign:'middle',marginRight:2}} />+{result.rewardXp} XP</span>);
  };

  if (!drillData) return <div className="loading">{t('common.loading')}</div>;

  const {
    drills, availableTypes, asteroids = [], maxDrills,
    unlockedSlots = 1, slotUnlockCostStars = 50, starsBalance = 0,
    collectibles, collections,
  } = drillData;

  const drillsBySlot = new Map(drills.map((d) => [Number(d.slotIndex || 1), d]));

  const visibleSlots = [1];
  if (drillsBySlot.get(1)) visibleSlots.push(2);
  if (drillsBySlot.get(2)) visibleSlots.push(3);

  const collectibleNames = {};
  if (collectibles) {
    for (const c of collectibles) collectibleNames[c.templateId] = ru ? c.name : (c.nameEn || c.name);
  }
  if (collections) {
    for (const collection of collections) {
      for (const item of collection.items || []) {
        if (!collectibleNames[item.collectibleId]) {
          collectibleNames[item.collectibleId] = ru ? item.collectibleName : (item.collectibleNameEn || item.collectibleName);
        }
      }
    }
  }

  const fossilsBadge = collectibles.length;
  const collectorBadge = collections.some((col) => {
    const allMet = col.items.every((i) => i.owned >= i.required);
    const nextAt = col.nextAvailableAt ? new Date(col.nextAvailableAt).getTime() : null;
    const onCooldown = Boolean(nextAt && nextAt > nowMs);
    return allMet && !onCooldown;
  });

  const TABS = [
    { key: 'drills',    label: t('drills.tabDrills'),    Icon: Pickaxe },
    { key: 'upgrades',  label: t('drills.tabUpgrades'),  Icon: Cog },
    { key: 'fossils',   label: t('drills.tabFossils'),   Icon: RockIcon, badge: fossilsBadge > 0 ? fossilsBadge : null },
    { key: 'collector', label: t('drills.tabCollector'), Icon: Award, badge: collectorBadge ? '!' : null },
  ];

  return (
    <div className={androidWebView ? 'android-drills-panel' : 'drills-panel'}>
      {toast && (
        <div className="expedition-toast-overlay">
          <div className={`idm-toast${toast.type === 'err' ? ' idm-toast--err' : ''}`}>{toast.msg}</div>
        </div>
      )}

      <div className={androidWebView ? 'android-drills-tabs' : 'drills-tabs'}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`${androidWebView ? 'android-drills-tab-btn' : 'drills-tab-btn'}${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className={androidWebView ? 'android-drills-tab-icon' : 'drills-tab-icon'}>{tab.Icon && <tab.Icon size={16} />}</span>
            <span className={androidWebView ? 'android-drills-tab-label' : 'drills-tab-label'}>{tab.label}</span>
            {tab.badge != null && (
              <span className={androidWebView ? 'android-drills-tab-badge' : 'drills-tab-badge'}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {androidWebView ? (
        <div className="android-drills-tab-content">
          {activeTab === 'drills' && (
            <div className="android-drills-grid">
              {visibleSlots.map((slotIndex) => {
                const drill = drillsBySlot.get(slotIndex);
                if (drill) {
                  return (
                    <AndroidDrillCard key={`android_slot_${slotIndex}_drill`} slotIndex={slotIndex} drill={drill}
                      onCollect={handleCollect} onDelete={handleDeleteDrill} onOpenAsteroidPicker={openAsteroidPicker}
                      collecting={collectingId === drill.id} deleting={deletingId === drill.id} />
                  );
                }
                if (slotIndex <= unlockedSlots) {
                  return (
                    <AndroidSlotPurchaseCard key={`android_slot_${slotIndex}_empty`} slotIndex={slotIndex}
                      availableTypes={availableTypes} onBuy={handleBuy} buyingId={buyingId} />
                  );
                }
                return (
                  <AndroidSlotLockedCard key={`android_slot_${slotIndex}_locked`} slotIndex={slotIndex}
                    canUnlock={slotIndex === unlockedSlots + 1} unlockCost={slotUnlockCostStars}
                    onUnlock={handleUnlockSlot} unlocking={unlockingSlot} />
                );
              })}
              {drills.length === 0 && (
                <div className="android-empty-state">{t('drills.selectForSlot1')}</div>
              )}
            </div>
          )}

          {activeTab === 'upgrades' && (
            drills.length > 0 ? (
              <div className="android-drills-grid">
                {drills.slice().sort((a, b) => Number(a.slotIndex || 0) - Number(b.slotIndex || 0)).map((drill) => (
                  <AndroidDrillUpgradeCard key={`android_upgrade_${drill.id}`} drill={drill}
                    onUpgrade={handleUpgrade} upgrading={upgradingId === drill.id} />
                ))}
              </div>
            ) : (
              <div className="android-empty-state">{t('drills.installFirst')}</div>
            )
          )}

          {activeTab === 'fossils' && (
            collectibles.length > 0 ? (
              <div className="android-fossil-grid">
                {collectibles.map((item) => (
                  <AndroidCollectibleItem key={`android_fossil_${item.id}`} item={item} onSell={handleSell} selling={sellingId === item.id} />
                ))}
              </div>
            ) : (
              <div className="android-empty-state">{t('drills.noFossils')}</div>
            )
          )}

          {activeTab === 'collector' && (
            <div className="android-drills-grid">
              <p className="android-drill-desc">{t('drills.collectFossils')}</p>
              {collections.map((col) => (
                <AndroidCollectionCard key={`android_collection_${col.id}`} collection={col}
                  collectibleNames={collectibleNames} onSubmit={handleSubmit}
                  submitting={submittingId === col.id} nowMs={nowMs} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <AnimatePresence>
          {activeTab === 'drills' && (
            <motion.div key="drills" className="drills-tab-content" animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <div className="drills-grid">
                {visibleSlots.map((slotIndex) => {
                  const drill = drillsBySlot.get(slotIndex);
                  if (drill) {
                    return (
                      <DrillCard key={`slot_${slotIndex}_drill`} slotIndex={slotIndex} drill={drill}
                        onCollect={handleCollect} onDelete={handleDeleteDrill} onOpenAsteroidPicker={openAsteroidPicker}
                        collecting={collectingId === drill.id} deleting={deletingId === drill.id} />
                    );
                  }
                  if (slotIndex <= unlockedSlots) {
                    return (
                      <SlotPurchaseCard key={`slot_${slotIndex}_empty`} slotIndex={slotIndex}
                        availableTypes={availableTypes} onBuy={handleBuy} buyingId={buyingId} />
                    );
                  }
                  return (
                    <SlotLockedCard key={`slot_${slotIndex}_locked`} slotIndex={slotIndex}
                      canUnlock={slotIndex === unlockedSlots + 1} unlockCost={slotUnlockCostStars}
                      onUnlock={handleUnlockSlot} unlocking={unlockingSlot} />
                  );
                })}
              </div>
              {drills.length === 0 && (
                <div className="empty-state">{t('drills.selectForSlot1')}</div>
              )}
            </motion.div>
          )}

          {activeTab === 'upgrades' && (
            <motion.div key="upgrades" className="drills-tab-content" animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {drills.length > 0 ? (
                <div className="drills-grid">
                  {drills.slice().sort((a, b) => Number(a.slotIndex || 0) - Number(b.slotIndex || 0)).map((drill) => (
                    <DrillUpgradeCard key={`upgrade_${drill.id}`} drill={drill}
                      onUpgrade={handleUpgrade} upgrading={upgradingId === drill.id} />
                  ))}
                </div>
              ) : (
                <div className="empty-state">{t('drills.installFirst')}</div>
              )}
            </motion.div>
          )}

          {activeTab === 'fossils' && (
            <motion.div key="fossils" className="drills-tab-content" animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {collectibles.length > 0 ? (
                <div className="collectibles-grid">
                  {collectibles.map((item) => (
                    <CollectibleItem key={item.id} item={item} onSell={handleSell} selling={sellingId === item.id} />
                  ))}
                </div>
              ) : (
                <div className="empty-state">{t('drills.noFossils')}</div>
              )}
            </motion.div>
          )}

          {activeTab === 'collector' && (
            <motion.div key="collector" className="drills-tab-content" animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <p className="drill-npc-desc">{t('drills.collectFossils')}</p>
              {collections.map((col) => (
                <CollectionCard key={col.id} collection={col} collectibleNames={collectibleNames}
                  onSubmit={handleSubmit} submitting={submittingId === col.id} nowMs={nowMs} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <AsteroidPickerModal
        visible={Boolean(pickerDrill)}
        drill={pickerDrill}
        asteroids={asteroids}
        onClose={() => setPickerDrill(null)}
        onAssign={handleAssignAsteroid}
        assigningId={assigningId}
      />

      <Modal
        open={Boolean(confirmDeleteId)}
        onClose={() => { setConfirmDeleteId(null); setDeleteCountdown(0); }}
        title={t('drills.deleteConfirmTitle')}
      >
        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <p style={{ marginBottom: 20, color: 'var(--text-secondary)', fontSize: 14 }}>
            {t('drills.deleteConfirmBody')}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => { setConfirmDeleteId(null); setDeleteCountdown(0); }}>
              {t('drills.cancel')}
            </button>
            <button className="btn btn-danger" disabled={deleteCountdown > 0} onClick={handleConfirmDelete}>
              {deleteCountdown > 0
                ? `${t('drills.delete')} (${deleteCountdown})`
                : t('drills.delete')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
