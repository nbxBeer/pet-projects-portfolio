import axios from 'axios';
import { nanoid } from 'nanoid';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Create axios instance
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request deduplication: only for inventory endpoint (fast category switching) ──
const pendingGets = new Map(); // url → AbortController
const DEDUP_ENDPOINTS = ['/user/inventory'];

api.interceptors.request.use((config) => {
  const initData = window.Telegram?.WebApp?.initData;
  if (initData) {
    config.headers['X-Telegram-Init-Data'] = initData;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param || urlParams.get('chat') || urlParams.get('ref');
  if (startParam) {
    config.headers['X-Telegram-Start-Param'] = startParam;
  }

  // Cancel previous GET only for known fast-switching endpoints
  if (config.method === 'get' && DEDUP_ENDPOINTS.some(e => config.url?.includes(e))) {
    const prev = pendingGets.get(config.url);
    if (prev) prev.abort();
    const controller = new AbortController();
    config.signal = controller.signal;
    pendingGets.set(config.url, controller);
  }
  return config;
});

// Response error normalizer
api.interceptors.response.use(
  (res) => {
    if (res.config?.url) pendingGets.delete(res.config.url);
    return res.data;
  },
  (err) => {
    if (err.config?.url) pendingGets.delete(err.config.url);
    // Silently swallow cancelled requests — resolve with undefined
    if (axios.isCancel(err)) return undefined;
    const message = err.response?.data?.error || err.message || 'Network error';
    const status = err.response?.status;
    const error = new Error(message);
    error.status = status;
    error.data = err.response?.data;
    throw error;
  }
);

// ── Nonce generator (anti-replay) ─────────────────────────────────────────
function nonce() {
  return nanoid(32);
}

// ── API methods ───────────────────────────────────────────────────────────

export const userApi = {
  getProfile: () => api.get('/user/profile'),
  getZones: () => api.get('/user/zones'),
  getStats: () => api.get('/user/stats'),
  getMiniTournament: () => api.get('/user/mini-tournament'),
  getAchievements: () => api.get('/user/achievements'),
  selectAchievement: (achievementId) => api.post('/user/select-achievement', { achievementId }),
  getInventory: (params = {}) => api.get('/user/inventory', { params }),
  getLeaderboard: (by = 'xp') => api.get('/leaderboard', { params: { by } }),
  getActiveEvent: () => api.get('/events/active'),
  getStarsBalance: () => api.get('/stars/balance'),
  createTopupInvoice: (amount) => api.post('/stars/topup', { amount }),
  getStarsHistory: (params = {}) => api.get('/stars/history', { params }),
  sellInventoryItem: (itemId) => api.post('/user/inventory/sell', { itemId, nonce: nonce() }),
  bulkSellItems: (itemIds) => api.post('/user/inventory/bulk-sell', { itemIds, nonce: nonce() }),
  remoteScanAsteroid: (itemId) => api.post('/user/inventory/remote-scan', { itemId }),
};

export const expeditionApi = {
  getActive: () => api.get('/expedition/active'),
  getHistory: (params = {}) => api.get('/expedition/history', { params }),

  start: ({ zoneId, clientSeed, longExpedition = false }) =>
    api.post('/expedition/start', { zoneId, clientSeed, longExpedition, nonce: nonce() }),

  collect: ({ expeditionId }) =>
    api.post('/expedition/collect', { expeditionId, nonce: nonce() }),

  takeAction: ({ resultId, action }) =>
    api.post('/expedition/action', { resultId, action, nonce: nonce() }),

  speedUp: ({ expeditionId }) =>
    api.post('/expedition/speedup', { expeditionId, nonce: nonce() }),

  pirateAction: ({ expeditionId, choice }) =>
    api.post('/expedition/pirate-action', { expeditionId, choice, nonce: nonce() }),
};

export const upgradesApi = {
  getInfo: () => api.get('/upgrades'),
  upgrade: ({ moduleType }) =>
    api.post('/upgrades/upgrade', { moduleType, nonce: nonce() }),
  getStarUpgrades:     () => api.get('/star-upgrades'),
  purchaseStarUpgrade: (upgradeId) => api.post('/star-upgrades/purchase', { upgradeId }),
};

export const tournamentApi = {
  getActive: () => api.get('/tournaments/active'),
  getLeaderboard: (tournamentId) => api.get(`/tournaments/${tournamentId}/leaderboard`),
};

export const shopApi = {
  getActiveBuffs: () => api.get('/shop/active-buffs'),
  purchaseCredits: ({ itemType }) => api.post('/shop/purchase-credits', { itemType, nonce: nonce() }),
  purchaseStars:   ({ itemType }) => api.post('/shop/purchase-stars',   { itemType, nonce: nonce() }),
};

export const customizationApi = {
  get:           ()               => api.get('/user/customization'),
  setHeaderColor: (color)         => api.post('/user/customization/header-color', { color }),
  setAvatar:      (avatarId)      => api.post('/user/customization/avatar',       { avatarId }),
  purchaseDecor:  (decorId)       => api.post('/user/customization/buy-decor',    { decorId, nonce: nonce() }),
  setDecor:       (decorId)       => api.post('/user/customization/set-decor',    { decorId }),
  purchaseSupport: ()              => api.post('/user/customization/buy-support',    { nonce: nonce() }),
  setZoneGlow:     (glow)          => api.post('/user/customization/zone-glow',     { glow }),
};

export const referralApi = {
  getStats: () => api.get('/referral/stats'),
  setReferrer: (referrerId) => api.post('/referral/set-referrer', { referrerId }),
  skip: () => api.post('/referral/skip'),
  claimActivation: () => api.post('/referral/claim-activation'),
  claimMilestone: (milestoneCount) => api.post('/referral/claim-milestone', { milestoneCount }),
};

export const newsApi = {
  getActive: () => api.get('/news/active'),
};

export const questApi = {
  getDashboard: () => api.get('/quests/dashboard'),
  claim: (questId) => api.post('/quests/claim', { questId }),
  buyout: (questId) => api.post('/quests/buyout', { questId }),
  reroll: (questId) => api.post('/quests/reroll', { questId }),
  smuggler: () => api.post('/quests/smuggler'),
  getItems: (questId) => api.get(`/quests/items?questId=${questId}`),
  deliver: (questId, itemIds) => api.post('/quests/deliver', { questId, itemIds }),
  sell: (questId, itemIds) => api.post('/quests/sell', { questId, itemIds }),
};

export const drillApi = {
  getAll: () => api.get('/drills'),
  collect: (drillId) => api.post(`/drills/collect/${drillId}`, { nonce: nonce() }),
  assignAsteroid: (drillId, asteroidId) => api.post('/drills/assign-asteroid', { drillId, asteroidId, nonce: nonce() }),
  purchase: (drillTypeId, payWith, slotIndex) => api.post('/drills/purchase', { drillTypeId, payWith, slotIndex, nonce: nonce() }),
  unlockSlot: () => api.post('/drills/unlock-slot', { nonce: nonce() }),
  upgrade: (drillId, upgradeType) => api.post(`/drills/upgrade/${drillId}`, { upgradeType, nonce: nonce() }),
  deleteDrill: (drillId) => api.delete(`/drills/${drillId}`),
  sellCollectible: (itemId) => api.post('/drills/sell-collectible', { itemId, nonce: nonce() }),
  submitCollection: (collectionId) => api.post('/drills/submit-collection', { collectionId, nonce: nonce() }),
};

export const storyApi = {
  getAll: () => api.get('/story'),
  claim: (questId) => api.post('/story/claim', { questId, nonce: nonce() }),
  useItem: (itemKey, selectedType) => api.post('/story/use', { itemKey, selectedType, nonce: nonce() }),
  markDialogSeen: (dialogId) => api.post(`/story/dialogs/${dialogId}/seen`, {}),
};

export const universeApi = {
  getState: () => api.get('/universe'),
  getZones: () => api.get('/universe/zones'),
  startTravel: () => api.post('/universe/travel', { nonce: nonce() }),
};

export const blitzApi = {
  getStatus:    () => api.get('/blitz/status'),
  start:        ({ zoneId })    => api.post('/blitz/start',         { zoneId,     nonce: nonce() }),
  continue:     ({ sessionId }) => api.post('/blitz/continue',      { sessionId,  nonce: nonce() }),
  cashout:      ({ sessionId }) => api.post('/blitz/cashout',       { sessionId,  nonce: nonce() }),
  sellCashout:  ({ sessionId }) => api.post('/blitz/sell-cashout',  { sessionId,  nonce: nonce() }),
  keepCashout:  ({ sessionId }) => api.post('/blitz/keep-cashout',  { sessionId,  nonce: nonce() }),
  skipCooldown: ()              => api.post('/blitz/skip-cooldown', {             nonce: nonce() }),
};

export const exhibitionApi = {
  send: (inventoryItemId) => api.post('/exhibition/send', { inventoryItemId }),
  status: () => api.get('/exhibition/status'),
  collect: () => api.post('/exhibition/collect', {}),
};

export const prestigeApi = {
  getStatus: () => api.get('/prestige/status'),
  claim:     () => api.post('/prestige/claim', {}),
};

export default api;
