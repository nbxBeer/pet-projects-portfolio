import { create } from 'zustand';
import { userApi, expeditionApi, upgradesApi, shopApi, tournamentApi, customizationApi, referralApi, questApi, newsApi, drillApi, storyApi, universeApi, exhibitionApi, blitzApi } from '../services/api';

export const useGameStore = create((set, get) => ({
  user: null,
  expedition: null,
  expeditionResult: null,
  pirateEncounter: null,       // set when outcome === 'pirate_encounter'
  expeditionCooldownUntil: null,
  inventory: [],
  inventoryTotal: 0,
  zones: [],
  selectedZoneId: (() => { try { return localStorage.getItem('starloot_last_zone'); } catch { return null; } })(),
  upgrades: null,
  activeEvent: null,
  activeTournament: null,
  activeNews: null,
  customization: null,
  activeBuffs: [],
  drillData: null,      // { drills, availableTypes, maxDrills, collectibles, collections }
  storyData: null,      // { quests, items }
  exhibitionStatus: null, // exhibition state from API
  stats: null,          // player stats (cached; refreshed on demand)
  statsLoadedAt: null,  // timestamp of last load
  blitz: {
    session: null,       // active session state from server
    cooldownUntil: null, // ISO string or null
    loading: false,
    result: null,        // { type:'cashout'|'detonated', ... }
    cardKey: 0,          // incremented atomically with session.card update
  },
  loading: { profile: false, expedition: false, action: false, upgrade: false, shop: false, stats: false },
  error: null,
  activeTab: 'expedition',
  shopAccordions: {},  // key → true/false

  setActiveTab: (tab) => set({ activeTab: tab }),
  setShopAccordion: (key, open) =>
    set((s) => ({ shopAccordions: { ...s.shopAccordions, [key]: open } })),
  setSelectedZoneId: (id) => {
    set({ selectedZoneId: id });
    try { localStorage.setItem('starloot_last_zone', id); } catch {}
  },

  async loadActiveEvent() {
    try {
      const data = await userApi.getActiveEvent();
      set({ activeEvent: data?.event || null });
    } catch {
      // non-critical — silently fail
    }
  },

  async loadActiveTournament() {
    try {
      const data = await tournamentApi.getActive();
      set({ activeTournament: data?.tournament || null });
    } catch {
      // non-critical — silently fail
    }
  },

  async loadActiveNews() {
    try {
      const data = await newsApi.getActive();
      set({ activeNews: data?.news || null });
    } catch {
      // non-critical — silently fail
    }
  },

  async loadProfile() {
    set((s) => ({ loading: { ...s.loading, profile: true }, error: null }));
    try {
      const [profile, activeExp, zonesData, buffsData] = await Promise.all([
        userApi.getProfile(),
        expeditionApi.getActive(),
        userApi.getZones(),
        shopApi.getActiveBuffs().catch(() => ({ buffs: [] })),
      ]);
      // Load active event, tournament, news, story, and exhibition in parallel (non-blocking)
      get().loadActiveEvent();
      get().loadActiveTournament();
      get().loadActiveNews();
      get().loadStory();
      get().loadExhibitionStatus();
      const activeExpedition = activeExp?.expedition || null;
      // hasVisitedUniverse2 is a one-way flag: once true it must stay true.
      // Guard against stale backend responses while the DB row is propagating.
      const prevHasVisited = get().user?.hasVisitedUniverse2 ?? false;
      set({
        user: { ...profile, hasVisitedUniverse2: profile.hasVisitedUniverse2 || prevHasVisited },
        expedition: activeExpedition,
        zones: Array.isArray(zonesData?.zones) ? zonesData.zones : [],
        activeBuffs: Array.isArray(buffsData?.buffs) ? buffsData.buffs : [],
        pirateEncounter: activeExpedition?.status === 'pirate_pending'
          ? { outcome: 'pirate_encounter', expeditionId: activeExpedition.expeditionId, pirateInfo: null }
          : null,
        expeditionCooldownUntil: profile.expeditionCooldownUntil ?? null,
        loading: { ...get().loading, profile: false },
      });
    } catch (err) {
      set({ error: err.message, loading: { ...get().loading, profile: false } });
    }
  },

  markExpeditionReady: () => set((s) => ({
    expedition: s.expedition
      ? { ...s.expedition, status: 'completed', endsAt: new Date(Date.now() - 2000).toISOString() }
      : s.expedition,
  })),

  async startExpedition(zoneId, longExpedition = false) {
    const clientSeed = generateClientSeed();
    set((s) => ({ loading: { ...s.loading, expedition: true }, error: null }));
    try {
      const result = await expeditionApi.start({ zoneId, clientSeed, longExpedition });
      set({
        expedition: { ...result, status: 'in_progress' },
        expeditionResult: null,
        loading: { ...get().loading, expedition: false },
      });
      return result;
    } catch (err) {
      set({ error: err.message, loading: { ...get().loading, expedition: false } });
      throw err;
    }
  },

  async collectExpedition(expeditionId) {
    set((s) => ({ loading: { ...s.loading, expedition: true }, error: null }));
    try {
      const result = await expeditionApi.collect({ expeditionId });

      // Pirate encounter — show special modal
      if (result.outcome === 'pirate_encounter') {
        set((s) => ({
          pirateEncounter: result,
          loading: { ...s.loading, expedition: false },
        }));
        return result;
      }

      const isAsteroidLike = result.findType === 'asteroid' || result.findType === 'nft_container';
      const isAutoComplete = result.outcome === 'cargo_full' || result.outcome === 'no_capsule';

      set((s) => ({
        expeditionResult: result,
        pirateEncounter: null,
        // Keep expedition as 'completed' until user takes action
        expedition: isAutoComplete ? null : { ...s.expedition, status: 'completed' },
        // Only update XP if auto-completed (cargo_full / no_capsule)
        user: isAutoComplete && result.newXP !== undefined ? {
          ...s.user,
          xp:                result.newXP,
          level:             result.newLevel             ?? s.user?.level,
          credits:           (s.user?.credits || 0) + (result.creditsGained || 0),
          xpForCurrentLevel: result.xpForCurrentLevel   ?? s.user?.xpForCurrentLevel,
          xpForNextLevel:    result.xpForNextLevel !== undefined ? result.xpForNextLevel : s.user?.xpForNextLevel,
        } : s.user,
        loading: { ...s.loading, expedition: false },
      }));

      // Reload zones if player leveled up
      if (result.newLevel && result.newLevel > (get().user?.level || 0)) {
        userApi.getZones().then((data) => {
          set({ zones: Array.isArray(data?.zones) ? data.zones : [] });
        }).catch(() => {});
      }
      return result;
    } catch (err) {
      set({ error: err.message, loading: { ...get().loading, expedition: false } });
      throw err;
    }
  },

  // Unified action for ALL item types: sell, collect (keep), save_coords
  async takeAction(resultId, action) {
    set((s) => ({ loading: { ...s.loading, action: true }, error: null }));
    try {
      const result = await expeditionApi.takeAction({ resultId, action });
      const prevLevel = get().user?.level || 0;
      set((s) => ({
        user: {
          ...s.user,
          credits:           (s.user?.credits || 0) + (result.creditsGained || 0),
          crystals:          (s.user?.crystals || 0) + (result.crystalsGained || 0),
          xp:                result.newXP    ?? s.user?.xp,
          level:             result.newLevel ?? s.user?.level,
          xpForCurrentLevel: result.xpForCurrentLevel ?? s.user?.xpForCurrentLevel,
          xpForNextLevel:    result.xpForNextLevel !== undefined ? result.xpForNextLevel : s.user?.xpForNextLevel,
        },
        expedition:       null,
        expeditionResult: null,
        loading: { ...s.loading, action: false },
      }));
      if (result.newLevel && result.newLevel > prevLevel) {
        userApi.getZones().then((data) => {
          set({ zones: Array.isArray(data?.zones) ? data.zones : [] });
        }).catch(() => {});
      }

      if (result.storyItemUnlocked) {
        await Promise.all([get().loadProfile(), get().loadStory()]);
      }

      // Refresh active buffs after action (buffs may have been consumed)
      await get().loadActiveBuffs();

      return result;
    } catch (err) {
      set({ error: err.message, loading: { ...get().loading, action: false } });
      throw err;
    }
  },

  // Sell item that's already in inventory (from inventory panel, NOT from result card)
  async sellInventoryItem(itemId) {
    set((s) => ({ loading: { ...s.loading, action: true }, error: null }));
    try {
      const result = await userApi.sellInventoryItem(itemId);
      set((s) => ({
        user:             {
          ...s.user,
          credits: result.creditsRemaining ?? s.user?.credits,
          crystals: result.crystalsRemaining ?? s.user?.crystals,
        },
        loading: { ...s.loading, action: false },
      }));
      return result;
    } catch (err) {
      set({ error: err.message, loading: { ...get().loading, action: false } });
      throw err;
    }
  },

  // Dismiss result card (for auto-complete outcomes only)
  clearExpeditionResult: () => set({ expeditionResult: null }),
  clearPirateEncounter: () => set({ pirateEncounter: null }),

  async pirateAction(expeditionId, choice) {
    set((s) => ({ loading: { ...s.loading, expedition: true }, error: null }));
    try {
      const result = await expeditionApi.pirateAction({ expeditionId, choice });
      if (result.outcome === 'pirate_defeat') {
        set((s) => ({
          pirateEncounter: null,
          expedition: null,
          expeditionCooldownUntil: result.cooldownUntil,
          loading: { ...s.loading, expedition: false },
        }));
        return result;
      }
      // Win / paid: show result. For auto-complete (cargo_full/no_capsule), update XP immediately.
      const isAutoComplete = result.outcome === 'cargo_full' || result.outcome === 'no_capsule';
      set((s) => ({
        expeditionResult: result,
        pirateEncounter: null,
        // Auto-complete: expedition is done. Normal: keep as completed until user acts.
        expedition: isAutoComplete ? null : { ...s.expedition, status: 'completed' },
        user: {
          ...s.user,
          starsBalance: result.starsSpent ? (s.user?.starsBalance || 0) - result.starsSpent : s.user?.starsBalance,
          // Update XP/credits for auto-complete outcomes
          ...(isAutoComplete && result.newXP !== undefined ? {
            xp:                result.newXP,
            level:             result.newLevel             ?? s.user?.level,
            credits:           (s.user?.credits || 0) + (result.creditsGained || 0),
            xpForCurrentLevel: result.xpForCurrentLevel   ?? s.user?.xpForCurrentLevel,
            xpForNextLevel:    result.xpForNextLevel !== undefined ? result.xpForNextLevel : s.user?.xpForNextLevel,
          } : {}),
        },
        loading: { ...s.loading, expedition: false },
      }));
      return result;
    } catch (err) {
      set({ error: err.message, loading: { ...get().loading, expedition: false } });
      throw err;
    }
  },

  async loadActiveBuffs() {
    try {
      const data = await shopApi.getActiveBuffs();
      set({ activeBuffs: Array.isArray(data?.buffs) ? data.buffs : [] });
    } catch {
      // non-critical — silently fail
    }
  },

  async purchaseBuff(itemType, payWith /* 'credits' | 'stars' */) {
    set((s) => ({ loading: { ...s.loading, shop: true }, error: null }));
    try {
      const fn = payWith === 'stars' ? shopApi.purchaseStars : shopApi.purchaseCredits;
      const result = await fn({ itemType });
      if (result.creditsRemaining !== undefined) {
        set((s) => ({ user: s.user ? { ...s.user, credits: result.creditsRemaining } : s.user }));
      }
      if (result.starsRemaining !== undefined) {
        set((s) => ({ user: s.user ? { ...s.user, starsBalance: result.starsRemaining } : s.user }));
      }
      await get().loadActiveBuffs();
      set((s) => ({ loading: { ...s.loading, shop: false } }));
      return result;
    } catch (err) {
      set({ error: err.message, loading: { ...get().loading, shop: false } });
      throw err;
    }
  },

  async loadAchievements() {
    try {
      const data = await userApi.getAchievements();
      return Array.isArray(data?.achievements) ? data.achievements : [];
    } catch { return []; }
  },

  async loadMiniTournament() {
    try {
      const data = await userApi.getMiniTournament();
      return data || null;
    } catch { return null; }
  },

  async selectAchievement(achievementId) {
    await userApi.selectAchievement(achievementId);
    set((s) => ({
      user: s.user ? {
        ...s.user,
        selectedAchievement: achievementId
          ? (s._achievementForBadge || null)
          : null,
      } : s.user,
    }));
  },

  _setAchievementBadge: (ach) => set((s) => ({
    user: s.user ? { ...s.user, selectedAchievement: ach } : s.user,
  })),

  async loadInventory(params = {}) {
    const { _replace = true, ...apiParams } = params;
    try {
      const data = await userApi.getInventory(apiParams);
      if (!data) return; // request was cancelled (dedup)
      const items = Array.isArray(data?.items) ? data.items : [];
      set((s) => ({
        inventory: _replace ? items : [...s.inventory, ...items],
        inventoryTotal: data?.total || 0,
      }));
      return data;
    } catch (err) {
      if (!err?.message) return; // cancelled
      set({ error: err.message });
    }
  },

  async loadUpgrades() {
    try {
      const data = await upgradesApi.getInfo();
      set({ upgrades: Array.isArray(data?.modules) ? data.modules : data?.modules || null });
    } catch (err) {
      set({ error: err.message });
    }
  },

  async upgradeModule(moduleType) {
    set((s) => ({ loading: { ...s.loading, upgrade: true }, error: null }));
    try {
      const result = await upgradesApi.upgrade({ moduleType });
      set((s) => ({
        user: {
          ...s.user,
          credits: result.creditsRemaining ?? s.user?.credits,
          crystals: result.crystalsRemaining ?? s.user?.crystals,
        },
        loading: { ...s.loading, upgrade: false },
      }));
      await get().loadUpgrades();
      return result;
    } catch (err) {
      set({ error: err.message, loading: { ...get().loading, upgrade: false } });
      throw err;
    }
  },

  async loadStats(force = false) {
    const { statsLoadedAt, loading } = get();
    if (!force && statsLoadedAt && Date.now() - statsLoadedAt < 60000) return;
    if (loading.stats) return;
    set((s) => ({ loading: { ...s.loading, stats: true } }));
    try {
      const data = await userApi.getStats();
      set({ stats: data, statsLoadedAt: Date.now(), loading: { ...get().loading, stats: false } });
    } catch (err) {
      set((s) => ({ loading: { ...s.loading, stats: false } }));
      throw err;
    }
  },

  updateStarsBalance: (balance) => set((s) => ({
    user: s.user ? { ...s.user, starsBalance: Number(balance) } : s.user,
  })),

  updateCredits: (credits) => set((s) => ({
    user: s.user ? { ...s.user, credits: Number(credits) } : s.user,
  })),

  updateCrystals: (crystals) => set((s) => ({
    user: s.user ? { ...s.user, crystals: Number(crystals) } : s.user,
  })),

  async loadCustomization() {
    try {
      const data = await customizationApi.get();
      set({ customization: data });
    } catch {
      // non-critical
    }
  },

  async setHeaderColor(color) {
    try {
      await customizationApi.setHeaderColor(color);
      set((s) => ({
        customization: s.customization ? { ...s.customization, headerColor: color } : s.customization,
        user: s.user ? { ...s.user, headerColor: color } : s.user,
      }));
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  async setAvatar(avatarId) {
    try {
      await customizationApi.setAvatar(avatarId);
      set((s) => ({
        customization: s.customization ? { ...s.customization, avatarId } : s.customization,
        user: s.user ? { ...s.user, avatarId } : s.user,
      }));
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  async purchaseDecor(decorId) {
    try {
      const result = await customizationApi.purchaseDecor(decorId);
      set((s) => ({
        customization: s.customization ? {
          ...s.customization,
          ownedDecors: [...(s.customization.ownedDecors || []), decorId],
        } : s.customization,
        user: s.user ? {
          ...s.user,
          ...(result.newBalance !== undefined ? { starsBalance: result.newBalance } : {}),
          ...(result.newCrystalsBalance !== undefined ? { crystals: result.newCrystalsBalance } : {}),
        } : s.user,
      }));
      return result;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  async setDecor(decorId) {
    try {
      await customizationApi.setDecor(decorId);
      set((s) => ({
        customization: s.customization ? { ...s.customization, activeDecorId: decorId } : s.customization,
        user: s.user ? { ...s.user, activeDecorId: decorId } : s.user,
      }));
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  async setZoneGlow(glow) {
    try {
      await customizationApi.setZoneGlow(glow);
      set((s) => ({
        customization: s.customization ? { ...s.customization, zoneGlow: glow } : s.customization,
        user: s.user ? { ...s.user, zoneGlow: glow } : s.user,
      }));
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  clearError: () => set({ error: null }),

  // ── Referral ───────────────────────────────────────────────────────────────
  referralStats: null,
  async loadReferralStats() {
    try {
      const data = await referralApi.getStats();
      set({ referralStats: data });
      return data;
    } catch { /* non-critical */ }
  },

  async setReferrer(referrerId) {
    return referralApi.setReferrer(referrerId);
  },

  async claimActivationReward() {
    const result = await referralApi.claimActivation();
    if (result?.claimed) {
      // Refresh profile to get updated credits
      get().loadProfile();
    }
    return result;
  },

  async claimMilestone(milestoneCount) {
    const result = await referralApi.claimMilestone(milestoneCount);
    if (result?.claimed) {
      get().loadProfile();
      get().loadReferralStats();
    }
    return result;
  },

  // ── Quests & Factions ───────────────────────────────────────────────────────
  questDashboard: null,
  async loadQuestDashboard() {
    try {
      const data = await questApi.getDashboard();
      set({ questDashboard: data });
      return data;
    } catch { /* non-critical */ }
  },

  async claimQuest(questId) {
    try {
      const result = await questApi.claim(questId);
      if (result?.claimed) {
        const prevLevel = get().user?.level || 0;
        set((s) => {
          const quest = s.questDashboard?.quests?.find(q => q.id === questId);
          const factionId = quest?.factionId;
          return {
            user: s.user ? {
              ...s.user,
              credits:      (s.user.credits || 0) + (result.credits || 0),
              starsBalance: (s.user.starsBalance || 0) + (result.stars || 0),
              xp:           result.newXP    ?? s.user.xp,
              level:        result.newLevel ?? s.user.level,
            } : s.user,
            questDashboard: s.questDashboard ? {
              ...s.questDashboard,
              quests: s.questDashboard.quests.map(q =>
                q.id === questId
                  ? { ...q, status: result.repeatableReactivated ? 'active' : 'claimed', progress: result.repeatableReactivated ? 0 : q.progress }
                  : q
              ),
              factions: s.questDashboard.factions.map(f => {
                const gain    = f.id === factionId ? (result.reputationGain || 0) : 0;
                const penalty = (result.reputationPenalties || []).find(p => p.factionId === f.id);
                const delta   = gain - (penalty ? penalty.amount : 0);
                return delta !== 0 ? { ...f, reputation: (f.reputation || 0) + delta } : f;
              }),
            } : s.questDashboard,
          };
        });
        if (result.storyItemReward) await get().loadStory();
        if (result.newLevel && result.newLevel > prevLevel) {
          userApi.getZones().then(data => {
            set({ zones: Array.isArray(data?.zones) ? data.zones : [] });
          }).catch(() => {});
        }
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async buyoutQuest(questId) {
    try {
      const result = await questApi.buyout(questId);
      if (result?.boughtOut) {
        set((s) => ({
          user: s.user ? { ...s.user, credits: (s.user.credits || 0) - (result.cost || 0) } : s.user,
          questDashboard: s.questDashboard ? {
            ...s.questDashboard,
            quests: s.questDashboard.quests.map(q =>
              q.id === questId ? { ...q, status: 'completed', progress: q.targetAmount } : q
            ),
          } : s.questDashboard,
        }));
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async rerollQuest(questId) {
    try {
      const result = await questApi.reroll(questId);
      if (result?.rerolled) {
        set((s) => ({
          questDashboard: s.questDashboard ? {
            ...s.questDashboard,
            quests: s.questDashboard.quests.map(q =>
              q.id === questId
                ? {
                    ...q,
                    templateId:   result.quest.templateId,
                    data:         result.quest,
                    targetAmount: result.quest.targetAmount,
                    progress:     0,
                    freeRerolls:  Math.max(0, (q.freeRerolls || 0) - 1),
                  }
                : q
            ),
          } : s.questDashboard,
        }));
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async smugglerExchange() {
    try {
      const result = await questApi.smuggler();
      if (result?.exchanged) {
        set((s) => ({
          user: s.user ? {
            ...s.user,
            credits:      (s.user.credits || 0) - (result.creditsSpent || 0),
            starsBalance: (s.user.starsBalance || 0) + (result.starsReceived || 0),
          } : s.user,
          questDashboard: s.questDashboard?.smuggler ? {
            ...s.questDashboard,
            smuggler: { ...s.questDashboard.smuggler, weeklyUsed: result.weeklyUsed },
          } : s.questDashboard,
        }));
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async getQuestItems(questId) {
    try {
      return await questApi.getItems(questId);
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async deliverQuestItems(questId, itemIds) {
    try {
      const result = await questApi.deliver(questId, itemIds);
      if (result?.delivered) {
        set((s) => ({
          questDashboard: s.questDashboard ? {
            ...s.questDashboard,
            quests: s.questDashboard.quests.map(q =>
              q.id === questId ? { ...q, progress: result.progress, status: result.status } : q
            ),
          } : s.questDashboard,
        }));
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async sellQuestItems(questId, itemIds) {
    try {
      const result = await questApi.sell(questId, itemIds);
      if (result?.sold) {
        set((s) => ({
          user: s.user ? { ...s.user, credits: (s.user.credits || 0) + (result.creditsGained || 0) } : s.user,
          questDashboard: s.questDashboard ? {
            ...s.questDashboard,
            quests: s.questDashboard.quests.map(q =>
              q.id === questId ? { ...q, progress: result.progress, status: result.status } : q
            ),
          } : s.questDashboard,
        }));
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  // ── Drills ───────────────────────────────────────────────────────────────
  async loadDrills() {
    try {
      const data = await drillApi.getAll();
      if (data) set({ drillData: data });
      return data;
    } catch (e) {
      set({ error: e.message });
      return null;
    }
  },

  async collectDrill(drillId) {
    try {
      const result = await drillApi.collect(drillId);
      set((s) => {
        const affectedDrill = (s.drillData?.drills || []).find(d => d.id === drillId);
        const exhaustedAsteroidId = result.exhausted && affectedDrill?.assignedAsteroid
          ? affectedDrill.assignedAsteroid.id : null;

        const newDrills = (s.drillData?.drills || []).map(d => {
          if (d.id !== drillId) return d;
          const newAsteroid = result.exhausted
            ? null
            : d.assignedAsteroid
              ? { ...d.assignedAsteroid, remainingVolume: Math.max(0, (d.assignedAsteroid.remainingVolume || 0) - (result.tonsCollected || 0)) }
              : null;
          return { ...d, balance: 0, balanceCredits: 0, isFull: false, assignedAsteroid: newAsteroid };
        });

        const newAsteroids = exhaustedAsteroidId
          ? (s.drillData?.asteroids || []).filter(a => a.id !== exhaustedAsteroidId)
          : (s.drillData?.asteroids || []);

        const newFossils = (result.fossilsFound || []).map(f => ({
          id: f.id, templateId: f.templateId, rarity: f.rarity,
          name: f.name, nameEn: f.nameEn, icon: f.icon,
          sellPrice: f.sellPrice || 10,
          acquiredAt: new Date().toISOString(),
        }));

        return {
          user: s.user ? { ...s.user, credits: (s.user.credits || 0) + (result.creditsCollected || 0) } : s.user,
          drillData: s.drillData ? {
            ...s.drillData,
            drills: newDrills,
            asteroids: newAsteroids,
            collectibles: [...(s.drillData.collectibles || []), ...newFossils],
          } : s.drillData,
        };
      });
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async assignDrillAsteroid(drillId, asteroidId) {
    try {
      const result = await drillApi.assignAsteroid(drillId, asteroidId);
      // Assignment changes asteroid availability — need full drills reload (no profile reload).
      if (result?.assigned) await get().loadDrills();
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async purchaseDrill(drillTypeId, payWith, slotIndex) {
    try {
      const result = await drillApi.purchase(drillTypeId, payWith, slotIndex);
      if (result?.drillId) {
        // Update balance locally from known drill type cost, then reload drill state.
        const drillType = get().drillData?.availableTypes?.find(t => t.id === drillTypeId);
        if (payWith === 'stars' && drillType?.costStars) {
          set((s) => ({ user: s.user ? { ...s.user, starsBalance: (s.user.starsBalance || 0) - drillType.costStars } : s.user }));
        } else if (drillType?.costCredits) {
          set((s) => ({ user: s.user ? { ...s.user, credits: (s.user.credits || 0) - drillType.costCredits } : s.user }));
        }
        await get().loadDrills();
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async unlockDrillSlot() {
    try {
      const result = await drillApi.unlockSlot();
      if (result?.unlockedSlots !== undefined) {
        set((s) => ({
          user: s.user ? { ...s.user, starsBalance: result.starsRemaining } : s.user,
          drillData: s.drillData ? { ...s.drillData, unlockedSlots: result.unlockedSlots } : s.drillData,
        }));
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async upgradeDrill(drillId, upgradeType) {
    try {
      const result = await drillApi.upgrade(drillId, upgradeType);
      if (result?.upgraded) {
        // Upgrade cost thresholds mirror backend UPGRADE_COSTS array.
        const UPGRADE_COSTS = [1500, 3000, 5500, 9000, 14000, 20000, 27000, 35000, 44000, 54000, 65000, 77000];
        const STORAGE_UPGRADE_CREDITS = 200;
        const FOSSIL_UPGRADE_STEP = 0.01;

        set((s) => {
          const drillBefore = (s.drillData?.drills || []).find(d => d.id === drillId);
          const costDeducted = drillBefore?.upgrades?.nextCost || 0;

          const newDrills = (s.drillData?.drills || []).map(d => {
            if (d.id !== drillId) return d;
            const prev = d.upgrades || {};
            const yieldLevel   = upgradeType === 'yield'   ? result.newTypeLevel : (prev.yieldLevel   || 0);
            const fossilLevel  = upgradeType === 'fossil'  ? result.newTypeLevel : (prev.fossilLevel  || 0);
            const valueLevel   = upgradeType === 'value'   ? result.newTypeLevel : (prev.valueLevel   || 0);
            const storageLevel = upgradeType === 'storage' ? result.newTypeLevel : (prev.storageLevel || 0);
            const { totalUsed, maxTotal } = result;
            const nextCost = totalUsed < maxTotal ? UPGRADE_COSTS[totalUsed] : null;
            const newUpgrades = { yieldLevel, fossilLevel, valueLevel, storageLevel, totalUsed, maxTotal, nextCost, canUpgrade: totalUsed < maxTotal };
            return {
              ...d,
              upgrades:           newUpgrades,
              yieldPerCycle:      upgradeType === 'yield'   ? (d.yieldPerCycle   || 0) + 1                    : d.yieldPerCycle,
              fossilChance:       upgradeType === 'fossil'  ? (d.fossilChance    || 0) + FOSSIL_UPGRADE_STEP  : d.fossilChance,
              storageLimitCredits: upgradeType === 'storage' ? (d.storageLimitCredits || 0) + STORAGE_UPGRADE_CREDITS : d.storageLimitCredits,
              storageLimit:       upgradeType === 'storage' ? (d.storageLimit    || 0) + STORAGE_UPGRADE_CREDITS : d.storageLimit,
            };
          });

          return {
            user: s.user ? { ...s.user, credits: (s.user.credits || 0) - costDeducted } : s.user,
            drillData: s.drillData ? { ...s.drillData, drills: newDrills } : s.drillData,
          };
        });
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async sellCollectible(itemId) {
    try {
      const result = await drillApi.sellCollectible(itemId);
      set((s) => ({
        user: s.user ? { ...s.user, credits: (s.user.credits || 0) + (result.creditsGained || 0) } : s.user,
        drillData: s.drillData ? {
          ...s.drillData,
          collectibles: (s.drillData.collectibles || []).filter(c => c.id !== itemId),
        } : s.drillData,
      }));
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async deleteDrill(drillId) {
    try {
      const result = await drillApi.deleteDrill(drillId);
      if (result?.deleted) {
        const deletedSlot = result.slotIndex;
        set((s) => ({
          drillData: s.drillData ? {
            ...s.drillData,
            drills: (s.drillData.drills || [])
              .filter(d => d.id !== drillId)
              .map(d => d.slotIndex > deletedSlot ? { ...d, slotIndex: d.slotIndex - 1 } : d),
          } : s.drillData,
        }));
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async submitCollection(collectionId) {
    try {
      const result = await drillApi.submitCollection(collectionId);
      const prevLevel = get().user?.level || 0;
      set((s) => {
        const collection = (s.drillData?.collections || []).find(c => c.id === collectionId);

        // Remove consumed collectibles (oldest-first, matching templateId).
        let remaining = [...(s.drillData?.collectibles || [])];
        if (collection?.items) {
          for (const req of collection.items) {
            let toRemove = req.required;
            remaining = remaining.filter(c => {
              if (c.templateId === req.collectibleId && toRemove > 0) { toRemove--; return false; }
              return true;
            });
          }
        }

        // Update collection cooldown state locally.
        const now = new Date();
        const cooldownMs = 24 * 60 * 60 * 1000;
        const nextAvailableAt = new Date(now.getTime() + cooldownMs);
        const newCollections = (s.drillData?.collections || []).map(c => {
          if (c.id !== collectionId) return c;
          const ownedByTemplate = {};
          for (const col of remaining) {
            ownedByTemplate[col.templateId] = (ownedByTemplate[col.templateId] || 0) + 1;
          }
          return {
            ...c,
            lastSubmitAt:    now,
            nextAvailableAt,
            onCooldown:      true,
            canSubmit:       false,
            items: (c.items || []).map(i => ({ ...i, owned: ownedByTemplate[i.collectibleId] || 0 })),
          };
        });

        return {
          user: s.user ? {
            ...s.user,
            credits: (s.user.credits || 0) + (result.rewardCredits || 0),
            xp:      result.newXP    ?? s.user.xp,
            level:   result.newLevel ?? s.user.level,
          } : s.user,
          drillData: s.drillData ? {
            ...s.drillData,
            collectibles: remaining,
            collections:  newCollections,
          } : s.drillData,
        };
      });
      if (result.newLevel && result.newLevel > prevLevel) {
        userApi.getZones().then(data => {
          set({ zones: Array.isArray(data?.zones) ? data.zones : [] });
        }).catch(() => {});
      }
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  // ── Story quests ──────────────────────────────────────────────────────────
  async loadStory() {
    try {
      const data = await storyApi.getAll();
      if (data) set({ storyData: data });
      return data;
    } catch (e) {
      return null;
    }
  },

  async claimStoryQuest(questId) {
    try {
      const result = await storyApi.claim(questId);
      await Promise.all([get().loadStory(), get().loadProfile()]);
      return result;
    } catch (e) {
      return { error: e.message || 'Error' };
    }
  },

  async useStoryItem(itemKey, selectedType) {
    try {
      const result = await storyApi.useItem(itemKey, selectedType);
      await Promise.all([get().loadStory(), get().loadProfile()]);
      return result;
    } catch (e) {
      return { error: e.message || 'Error', ...e.data };
    }
  },

  // ── Exhibition ────────────────────────────────────────────────────────────
  async loadExhibitionStatus() {
    try {
      const data = await exhibitionApi.status();
      if (data) {
        set({ exhibitionStatus: data });
        // Schedule auto-refresh the moment the exhibition timer expires
        if (data.isActive && !data.isReady && data.endsAt) {
          const ms = new Date(data.endsAt) - Date.now();
          if (ms > 0 && ms < 25 * 3600 * 1000) {
            setTimeout(() => get().loadExhibitionStatus(), ms + 1500);
          }
        }
      }
      return data;
    } catch { return null; }
  },

  async sendToExhibition(inventoryItemId) {
    try {
      const result = await exhibitionApi.send(inventoryItemId);
      await get().loadExhibitionStatus();
      return result;
    } catch (e) {
      throw e;
    }
  },

  async collectExhibition() {
    try {
      const result = await exhibitionApi.collect();
      await Promise.all([get().loadExhibitionStatus(), get().loadProfile()]);
      return result;
    } catch (e) {
      throw e;
    }
  },

  // ── Blitz Raid ────────────────────────────────────────────────────────────

  async loadBlitzStatus() {
    try {
      const data = await blitzApi.getStatus();
      set((s) => ({
        blitz: {
          ...s.blitz,
          session: data.hasActiveSession ? data : null,
          cooldownUntil: data.cooldownUntil || null,
        },
      }));
    } catch { /* non-critical */ }
  },

  async startBlitzSession(zoneId) {
    set((s) => ({ blitz: { ...s.blitz, loading: true } }));
    try {
      const data = await blitzApi.start({ zoneId });
      set((s) => ({ blitz: { ...s.blitz, session: data, cooldownUntil: null, loading: false, result: null } }));
      return data;
    } catch (err) {
      set((s) => ({ blitz: { ...s.blitz, loading: false } }));
      throw err;
    }
  },

  async continueBlitz(sessionId) {
    set((s) => ({ blitz: { ...s.blitz, loading: true } }));
    try {
      const data = await blitzApi.continue({ sessionId });
      if (data.survived) {
        set((s) => ({
          blitz: {
            ...s.blitz,
            loading: false,
            cardKey: s.blitz.cardKey + 1,  // atomic with card data — guarantees one render
            session: {
              ...s.blitz.session,
              card: data.nextCard,
              swipeCount: data.swipeCount,
              explosionChance: data.explosionChance,
              accumulatedCount: data.accumulatedCount,
              accumulatedCredits: data.accumulatedCredits,
              stabilizerSwipesRemaining: data.stabilizerSwipesRemaining,
            },
          },
        }));
      } else {
        set((s) => ({
          blitz: {
            ...s.blitz,
            loading: false,
            session: null,
            cooldownUntil: data.cooldownUntil,
            result: { type: 'detonated', ...data },
          },
        }));
      }
      return data;
    } catch (err) {
      set((s) => ({ blitz: { ...s.blitz, loading: false } }));
      throw err;
    }
  },

  async cashoutBlitz(sessionId) {
    set((s) => ({ blitz: { ...s.blitz, loading: true } }));
    try {
      const data = await blitzApi.cashout({ sessionId });
      set((s) => ({
        blitz: {
          ...s.blitz,
          loading: false,
          session: null,
          cooldownUntil: data.cooldownUntil,
          result: { type: 'cashout', ...data },
        },
        user: s.user ? {
          ...s.user,
          credits: data.newCredits ?? s.user.credits,
          crystals: data.newCrystals ?? s.user.crystals,
          xp: data.newXP ?? s.user.xp,
        } : s.user,
      }));
      return data;
    } catch (err) {
      set((s) => ({ blitz: { ...s.blitz, loading: false } }));
      throw err;
    }
  },

  async sellBlitzCashout(sessionId) {
    set((s) => ({ blitz: { ...s.blitz, loading: true } }));
    try {
      const data = await blitzApi.sellCashout({ sessionId });
      set((s) => ({
        blitz: { ...s.blitz, loading: false, result: null },
        user: s.user ? {
          ...s.user,
          credits: data.newCredits ?? s.user.credits,
          crystals: data.newCrystals ?? s.user.crystals,
        } : s.user,
      }));
      return data;
    } catch (err) {
      set((s) => ({ blitz: { ...s.blitz, loading: false } }));
      throw err;
    }
  },

  async keepBlitzCashout(sessionId) {
    set((s) => ({ blitz: { ...s.blitz, loading: true } }));
    try {
      const data = await blitzApi.keepCashout({ sessionId });
      set((s) => ({ blitz: { ...s.blitz, loading: false, result: null } }));
      return data;
    } catch (err) {
      set((s) => ({ blitz: { ...s.blitz, loading: false } }));
      throw err;
    }
  },

  clearBlitzResult: () => set((s) => ({ blitz: { ...s.blitz, result: null } })),

  async skipBlitzCooldown() {
    set((s) => ({ blitz: { ...s.blitz, loading: true } }));
    try {
      const data = await blitzApi.skipCooldown();
      set((s) => ({
        blitz: { ...s.blitz, loading: false, cooldownUntil: null },
        user: s.user ? { ...s.user, starsBalance: data.newStarsBalance ?? Math.max(0, (s.user.starsBalance || 0) - 15) } : s.user,
      }));
    } catch (err) {
      set((s) => ({ blitz: { ...s.blitz, loading: false } }));
      throw err;
    }
  },

  async startUniverseTravel() {
    try {
      const result = await universeApi.startTravel();
      // Refresh profile to get updated universeTravelUntil / currentUniverse
      await get().loadProfile();
      return result;
    } catch (e) {
      throw e;
    }
  },

  async completeUniverseTravel() {
    try {
      // The backend auto-completes when travel timer expired — re-POSTing travel does it
      const result = await universeApi.startTravel();
      await get().loadProfile();
      return result;
    } catch (e) {
      throw e;
    }
  },
}));

function generateClientSeed() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}
