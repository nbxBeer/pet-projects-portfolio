import { useState, useEffect, memo, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTelegram } from '../../hooks/useTelegram';
import { t, isRu } from '../../i18n';
import { CoinIcon, CrystalIcon, Dna, Star, Package, Check, RefreshCw, Calendar, Lock, AlertTriangle, Sparkles, FactionIcon } from '../../icons';
import StoryDialogModal from './StoryDialogModal';
import { storyApi } from '../../services/api';

const FACTION_ORDER = [
  'bioengineers', 'tech_institute', 'navigators_order', 'black_market',
  'chroniclers', 'void_seekers', 'resonators', 'haulers',
];

const RARITY_CLS = {
  common: 'r-common', rare: 'r-rare', epic: 'r-epic', legendary: 'r-legendary',
  mythical: 'r-mythical', exotic: 'r-rare', ancient: 'r-epic',
  relic: 'r-legendary', hybrid: 'r-mythical', singularity: 'r-mythical',
};

const QuestsView = memo(function QuestsView() {
  const dashboard = useGameStore((s) => s.questDashboard);
  const loadDashboard = useGameStore((s) => s.loadQuestDashboard);
  const claimQuest = useGameStore((s) => s.claimQuest);
  const buyoutQuest = useGameStore((s) => s.buyoutQuest);
  const rerollQuest = useGameStore((s) => s.rerollQuest);
  const smugglerExchange = useGameStore((s) => s.smugglerExchange);
  const getQuestItems = useGameStore((s) => s.getQuestItems);
  const deliverQuestItems = useGameStore((s) => s.deliverQuestItems);
  const sellQuestItems = useGameStore((s) => s.sellQuestItems);
  const { showConfirm } = useTelegram();
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [itemModal, setItemModal] = useState(null);
  const [pendingDialogs, setPendingDialogs] = useState([]);
  const [activeDialog, setActiveDialog] = useState(null);

  useEffect(() => { loadDashboard(); }, []);

  useEffect(() => {
    if (dashboard?.pendingDialogs?.length) {
      setPendingDialogs(dashboard.pendingDialogs);
      const first = dashboard.pendingDialogs[0];
      setExpanded(prev => prev || first.factionId);
      setActiveDialog(prev => prev || first);
    }
  }, [dashboard?.pendingDialogs]);

  const handleDialogDismiss = useCallback(async (markSeen) => {
    if (!activeDialog) return;
    if (markSeen) {
      try { await storyApi.markDialogSeen(activeDialog.id); } catch { }
      setPendingDialogs(prev => prev.filter(d => d.id !== activeDialog.id));
    }
    setActiveDialog(null);
  }, [activeDialog]);

  const dialogsByFaction = {};
  pendingDialogs.forEach(d => {
    if (!dialogsByFaction[d.factionId]) dialogsByFaction[d.factionId] = [];
    dialogsByFaction[d.factionId].push(d);
  });

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  if (!dashboard) {
    return <div className="center-spinner" style={{ minHeight: 200 }}><span className="spinner spinner-lg" /></div>;
  }

  const { factions, quests, timers, smuggler, items } = dashboard;

  const nextRefresh = (type) => {
    if (!timers?.[type]) return null;
    const diff = new Date(timers[type]) - Date.now();
    if (diff <= 0) return t('quest.soon');
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0
      ? `${h}${t('quest.h')} ${m}${t('quest.m')}`
      : `${m}${t('quest.m')}`;
  };

  const toggle = (id) => setExpanded(prev => prev === id ? null : id);

  const handleClaim = async (questId) => {
    setBusy(questId);
    try {
      const res = await claimQuest(questId);
      if (res?.claimed) {
        const parts = [];
        if (res.crystals) parts.push(`+${res.crystals.toLocaleString()} 💎`);
        if (res.credits) parts.push(`+${res.credits.toLocaleString()}`);
        if (res.xp) parts.push(`+${res.xp} XP`);
        if (res.stars) parts.push(`+${res.stars} Stars`);
        if (res.reputationGain) parts.push(`+${res.reputationGain} rep`);
        showToast(parts.join(' · '));
      } else showToast(res?.error || 'Error');
    } catch (e) { showToast(e.message || 'Error'); }
    finally { setBusy(null); }
  };

  const handleBuyout = async (questId, cost) => {
    const ok = await showConfirm(t('quest.buyoutConfirm', { cost: cost.toLocaleString() }));
    if (!ok) return;
    setBusy('buyout_' + questId);
    try {
      const res = await buyoutQuest(questId);
      if (res?.boughtOut) showToast(t('quest.boughtOut', { cost: res.cost.toLocaleString() }));
      else showToast(res?.error || 'Error');
    } catch (e) { showToast(e.message || 'Error'); }
    finally { setBusy(null); }
  };

  const handleReroll = async (questId) => {
    const ok = await showConfirm(t('quest.rerollConfirm'));
    if (!ok) return;
    setBusy('reroll_' + questId);
    try {
      const res = await rerollQuest(questId);
      if (res?.rerolled) showToast(t('quest.rerolled'));
      else showToast(res?.error || 'Error');
    } catch (e) { showToast(e.message || 'Error'); }
    finally { setBusy(null); }
  };

  const handleSmuggler = async () => {
    setBusy('smuggler');
    try {
      const res = await smugglerExchange();
      if (res?.exchanged) showToast(t('quest.starExchangeResult', { credits: res.creditsSpent.toLocaleString() }));
      else showToast(res?.error || 'Error');
    } catch (e) { showToast(e.message || 'Error'); }
    finally { setBusy(null); }
  };

  const openItemModal = async (questId, questType) => {
    setBusy('items_' + questId);
    try {
      const res = await getQuestItems(questId);
      if (res?.error) { showToast(res.error); return; }
      setItemModal({
        questId,
        questType,
        items: res.items || [],
        remaining: res.remaining || 0,
        selected: new Set(),
      });
    } catch (e) { showToast(e.message || 'Error'); }
    finally { setBusy(null); }
  };

  const toggleItemSelect = (itemId) => {
    if (!itemModal) return;
    const sel = new Set(itemModal.selected);
    if (sel.has(itemId)) sel.delete(itemId);
    else if (sel.size < itemModal.remaining) sel.add(itemId);
    setItemModal({ ...itemModal, selected: sel });
  };

  const selectAllItems = () => {
    if (!itemModal) return;
    const sel = new Set();
    const max = itemModal.remaining;
    for (let i = 0; i < Math.min(itemModal.items.length, max); i++) {
      sel.add(itemModal.items[i].id);
    }
    setItemModal({ ...itemModal, selected: sel });
  };

  const submitItems = async () => {
    if (!itemModal || itemModal.selected.size === 0) return;
    const ids = [...itemModal.selected];
    setBusy('submit_items');
    try {
      let res;
      if (itemModal.questType === 'deliver_object') {
        res = await deliverQuestItems(itemModal.questId, ids);
        if (res?.delivered) {
          showToast(t('quest.delivered', { n: res.delivered }));
        } else showToast(res?.error || 'Error');
      } else {
        res = await sellQuestItems(itemModal.questId, ids);
        if (res?.sold) {
          showToast(<span>{t('quest.soldNFor', { n: res.sold })}<CoinIcon size={12} style={{verticalAlign:'middle',marginRight:2}} />{res.creditsGained.toLocaleString()}</span>);
        } else showToast(res?.error || 'Error');
      }
      setItemModal(null);
    } catch (e) { showToast(e.message || 'Error'); }
    finally { setBusy(null); }
  };

  const questsByFaction = {};
  quests.forEach(q => {
    if (!questsByFaction[q.factionId]) questsByFaction[q.factionId] = [];
    questsByFaction[q.factionId].push(q);
  });

  const sortedFactions = [...factions].sort((a, b) => FACTION_ORDER.indexOf(a.id) - FACTION_ORDER.indexOf(b.id));

  return (
    <div className="quests-view">
      {toast && <div className="ref-toast">{toast}</div>}

      {activeDialog && (
        <StoryDialogModal
          dialog={activeDialog}
          onDismiss={handleDialogDismiss}
        />
      )}

      {itemModal && (
        <div className="qa-item-modal-bg" onClick={() => setItemModal(null)}>
          <div className="qa-item-modal" onClick={e => e.stopPropagation()}>
            <div className="qa-item-modal-header">
              <span>{itemModal.questType === 'deliver_object'
                ? (<><Package size={14} style={{verticalAlign:'middle',marginRight:4}} />{t('quest.selectToDeliver')}</>)
                : (<><CoinIcon size={14} style={{verticalAlign:'middle',marginRight:4}} />{t('quest.selectToSell')}</>)}</span>
              <button className="qa-item-modal-close" onClick={() => setItemModal(null)}>✕</button>
            </div>
            <div className="qa-item-modal-info">
              {t('quest.need')}: {itemModal.selected.size}/{itemModal.remaining}
              <button className="btn btn-secondary qa-small-btn" style={{ marginLeft: 8 }} onClick={selectAllItems}>
                {t('quest.selectAll')}
              </button>
            </div>
            <div className="qa-item-list">
              {itemModal.items.length === 0 && (
                <div className="qa-empty">{t('quest.noMatchingItems')}</div>
              )}
              {itemModal.items.map(item => {
                const obj = item.object_data || {};
                const cls = RARITY_CLS[item.rarity] || '';
                return (
                  <label key={item.id} className={`qa-item-row ${itemModal.selected.has(item.id) ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={itemModal.selected.has(item.id)}
                      onChange={() => toggleItemSelect(item.id)}
                    />
                    <span className={cls}>{obj.name || item.find_type}</span>
                    <span className={`qa-item-rarity ${cls}`}>{t(`quest.rarityShort.${item.rarity}`)}</span>
                  </label>
                );
              })}
            </div>
            <div className="qa-item-modal-footer">
              <button
                className="btn btn-collect qa-item-submit"
                onClick={submitItems}
                disabled={itemModal.selected.size === 0 || busy === 'submit_items'}
              >
                {busy === 'submit_items' ? <span className="spinner" /> :
                  itemModal.questType === 'deliver_object'
                    ? (<><Package size={14} style={{verticalAlign:'middle',marginRight:4}} />{t('quest.deliverCount', { n: itemModal.selected.size })}</>)
                    : (<><CoinIcon size={14} style={{verticalAlign:'middle',marginRight:4}} />{t('quest.sellCount', { n: itemModal.selected.size })}</>)}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="qa-timers">
        {timers?.daily && <span className="qa-timer-chip"><Calendar size={12} style={{verticalAlign:'middle',marginRight:3}} />{nextRefresh('daily')}</span>}
        {timers?.weekly && <span className="qa-timer-chip"><Calendar size={12} style={{verticalAlign:'middle',marginRight:3}} />{nextRefresh('weekly')}</span>}
      </div>

      {sortedFactions.map(f => {
        const fQuests = questsByFaction[f.id] || [];
        const fDialogs = dialogsByFaction[f.id] || [];
        const isOpen = expanded === f.id;
        const activeCount = fQuests.filter(q => q.status === 'active').length;
        const doneCount = fQuests.filter(q => q.status === 'completed').length;
        const dialogCount = fDialogs.length;

        return (
          <div key={f.id} className={`qa-faction ${isOpen ? 'open' : ''}`} data-faction={f.id}>
            <button className="qa-faction-header" onClick={() => toggle(f.id)}>
              <span className="qa-faction-icon"><FactionIcon factionId={f.id} size={20} /></span>
              <div className="qa-faction-mid">
                <span className="qa-faction-name">{isRu() ? f.name : f.nameEn}</span>
                <div className="qa-faction-rep-mini">
                  <div className="qa-rep-bar-bg">
                    <div className="qa-rep-bar-fill" style={{ width: `${Math.max(2, (f.reputation + 1000) / 2000 * 100)}%` }} />
                  </div>
                  <span className="qa-rep-tier">{f.tier.icon} {f.reputation}</span>
                </div>
              </div>
              <div className="qa-faction-badges">
                {dialogCount > 0 && <span className="qa-badge qa-badge-dialog">💬</span>}
                {doneCount > 0 && <span className="qa-badge qa-badge-done">{doneCount}</span>}
                {activeCount > 0 && <span className="qa-badge qa-badge-active">{activeCount}</span>}
              </div>
              <span className={`qa-chevron ${isOpen ? 'open' : ''}`}>›</span>
            </button>

            {isOpen && (
              <div className="qa-faction-body">
                {(dialogsByFaction[f.id] || []).map(dialog => (
                  <div key={dialog.id} className="qa-quest sdm-invite-card">
                    <div className="qa-quest-row">
                      <div className="qa-quest-info">
                        <div className="qa-quest-name">
                          <span className="qa-type-badge qa-type-story">{t('quest.story')}</span>
                          {t('quest.wantsToTalk', { name: isRu() ? dialog.npc.nameRu : dialog.npc.nameEn })}
                        </div>
                        <div className="qa-quest-desc">
                          {isRu() ? dialog.npc.titleRu : dialog.npc.titleEn}
                        </div>
                      </div>
                    </div>
                    <div className="qa-quest-bottom">
                      <div className="qa-rewards" />
                      <div className="qa-actions">
                        <button
                          className="btn btn-collect qa-claim-btn sdm-contact-btn"
                          onClick={() => setActiveDialog(dialog)}
                        >
                          {t('quest.contact')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {fQuests.length === 0 && !dialogsByFaction[f.id]?.length && (
                  <div className="qa-empty">{t('quest.noQuests')}</div>
                )}
                {fQuests.map(q => (
                  <QuestCard
                    key={q.id}
                    quest={q}
                    factionIcon={f.icon}
                    busy={busy}
                    onClaim={handleClaim}
                    onBuyout={q.questType === 'daily' ? handleBuyout : null}
                    onReroll={handleReroll}
                    onOpenItems={openItemModal}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {smuggler && (
        <div className={`qa-faction qa-smuggler-section ${expanded === 'smuggler' ? 'open' : ''}`}>
          <button className="qa-faction-header" onClick={() => toggle('smuggler')}>
            <span className="qa-faction-icon">🕶️</span>
            <div className="qa-faction-mid">
              <span className="qa-faction-name">{t('quest.smuggler')}</span>
              <span className="qa-smuggler-sub">
                {smuggler.weeklyUsed}/{smuggler.weeklyLimit} {t('quest.perWeek')}
              </span>
            </div>
            <span className={`qa-chevron ${expanded === 'smuggler' ? 'open' : ''}`}>›</span>
          </button>

          {expanded === 'smuggler' && (
            <div className="qa-faction-body qa-smuggler-body">
              <div className="qa-smuggler-desc">
                <CoinIcon size={12} style={{verticalAlign:'middle',marginRight:2}} />
                {t('quest.smugglerDesc', { credits: smuggler.creditsPerStar.toLocaleString() })}
                {' '}<Star size={12} style={{verticalAlign:'middle',marginLeft:2}} />
              </div>
              {!smuggler.available && (
                <div className="qa-smuggler-locked">
                  <Lock size={12} style={{verticalAlign:'middle',marginRight:4}} />
                  {t('quest.blackMarketRep', { required: smuggler.requiredReputation, current: smuggler.currentReputation })}
                </div>
              )}
              {smuggler.available && smuggler.weeklyUsed < smuggler.weeklyLimit && (
                <button
                  className="btn btn-collect qa-smuggler-btn"
                  onClick={handleSmuggler}
                  disabled={busy === 'smuggler'}
                >
                  {busy === 'smuggler' ? <span className="spinner" /> : <><Sparkles size={14} style={{verticalAlign:'middle',marginRight:4}} />{t('quest.exchange')}</>}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {items && items.length > 0 && (
        <div className="qa-items-section">
          <div className="qa-items-title"><Package size={14} style={{verticalAlign:'middle',marginRight:4}} />{t('quest.items')}</div>
          <div className="qa-items">
            {items.map(item => (
              <div key={item.id} className="qa-item-chip">
                <span>{item.icon}</span>
                <span>{isRu() ? item.nameRu : item.nameEn}</span>
                <span className="qa-item-val">+{item.value}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

function QuestCard({ quest, factionIcon, busy, onClaim, onBuyout, onReroll, onOpenItems }) {
  const { id, data: qd, progress, targetAmount, status, freeRerolls } = quest;
  const pct = Math.min(100, Math.round(progress / targetAmount * 100));
  const isComplete = status === 'completed';
  const isClaimed = status === 'claimed';
  const remaining = targetAmount - progress;
  const isU2Quest = (qd.rewardCrystals || 0) > 0;
  const buyoutRewardValue = isU2Quest ? (qd.rewardCrystals || 0) : (qd.rewardCredits || 0);
  const buyoutCost = Math.ceil(remaining * buyoutRewardValue * 2 / targetAmount);
  const needsItems = (qd.type === 'deliver_object' || qd.type === 'sell_object') && status === 'active';

  const isSpecial = quest.questType === 'special';
  const isStory = quest.questType === 'story';
  const typeBadge = quest.questType === 'daily'
    ? { cls: 'qa-type-daily', label: t('quest.typeDaily') }
    : quest.questType === 'weekly'
      ? { cls: 'qa-type-weekly', label: t('quest.typeWeekly') }
      : quest.questType === 'repeatable'
        ? { cls: 'qa-type-repeatable', label: t('quest.typeRepeatable') }
      : quest.questType === 'story'
        ? { cls: 'qa-type-story', label: t('quest.typeStory') }
      : null;

  return (
    <div className={`qa-quest ${isClaimed ? 'claimed' : ''} ${isComplete ? 'complete' : ''} ${(isSpecial || isStory) ? 'qa-quest-special' : ''}`}>
      <div className="qa-quest-row">
        <div className="qa-quest-info">
          <div className="qa-quest-name">
            {isSpecial && <span className="qa-special-badge">✦ {t('quest.specBadge')}</span>}
            {!isSpecial && typeBadge && <span className={`qa-type-badge ${typeBadge.cls}`}>{typeBadge.label}</span>}
            {isRu() ? qd.nameRu : qd.nameEn}
            {qd.rewardStars > 0 && <span className="qa-star-badge"><Star size={11} style={{verticalAlign:'middle',marginRight:1}} />{qd.rewardStars}</span>}
          </div>
          <div className="qa-quest-desc">{isRu() ? qd.descRu : qd.descEn}</div>
        </div>
        {needsItems && (
          <button
            className="btn qa-action-text-btn btn-collect"
            onClick={() => onOpenItems(id, qd.type)}
            disabled={busy === 'items_' + id}
          >
            {busy === 'items_' + id ? <span className="spinner" /> :
              qd.type === 'deliver_object'
                ? (<><Package size={13} style={{verticalAlign:'middle',marginRight:3}} />{t('quest.deliver')}</>)
                : (<><CoinIcon size={13} style={{verticalAlign:'middle',marginRight:3}} />{t('quest.sell')}</>)}
          </button>
        )}
        {isClaimed && <span className="qa-done-check"><Check size={14} /></span>}
      </div>

      <div className="qa-prog-wrap">
        <div className="qa-prog-bar" style={{ width: `${pct}%` }} />
        <span className="qa-prog-text">{progress}/{targetAmount}</span>
      </div>

      <div className="qa-quest-bottom">
        <div className="qa-rewards">
          {(qd.rewardCrystals > 0)
            ? <span><CrystalIcon size={12} style={{verticalAlign:'middle',marginRight:1}} />{qd.rewardCrystals.toLocaleString()}</span>
            : <span><CoinIcon size={12} style={{verticalAlign:'middle',marginRight:1}} />{(qd.rewardCredits || 0).toLocaleString()}</span>
          }
          <span><Dna size={12} style={{verticalAlign:'middle',marginRight:1}} />{qd.rewardXp}xp</span>
          <span><FactionIcon factionId={quest.factionId} size={12} style={{verticalAlign:'middle',marginRight:2}} />+{qd.reputationGain}</span>
          {qd.storyRewardItem?.data?.icon && <span>+{qd.storyRewardItem.data.icon}</span>}
          {qd.reputationPenalties?.length > 0 && qd.reputationPenalties.map((p, i) => (
            <span key={i} className="qa-rep-penalty"><AlertTriangle size={11} style={{verticalAlign:'middle',marginRight:1}} />-{p.amount}</span>
          ))}
        </div>
        <div className="qa-actions">
          {isComplete && !isClaimed && (
            <button className="btn btn-collect qa-claim-btn" onClick={() => onClaim(id)} disabled={busy === id}>
              {busy === id ? <span className="spinner" /> : t('quest.claim')}
            </button>
          )}
          {status === 'active' && onBuyout && (
            <button className="btn btn-secondary qa-small-btn" onClick={() => onBuyout(id, buyoutCost)} disabled={busy === 'buyout_' + id}>
              {busy === 'buyout_' + id ? <span className="spinner" /> : (
                isU2Quest
                  ? <><CrystalIcon size={12} style={{verticalAlign:'middle',marginRight:2}} />{buyoutCost.toLocaleString()}</>
                  : <><CoinIcon size={12} style={{verticalAlign:'middle',marginRight:2}} />{buyoutCost.toLocaleString()}</>
              )}
            </button>
          )}
          {status === 'active' && freeRerolls > 0 && onReroll && (
            <button className="btn btn-secondary qa-small-btn" onClick={() => onReroll(id)} disabled={busy === 'reroll_' + id}>
              {busy === 'reroll_' + id ? <span className="spinner" /> : <><RefreshCw size={12} style={{verticalAlign:'middle',marginRight:2}} />{freeRerolls}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default QuestsView;
