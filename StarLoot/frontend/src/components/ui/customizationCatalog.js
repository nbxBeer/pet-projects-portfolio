// Mirrors backend/src/services/customizationService.js catalog
// Keep in sync manually if items are added.

import { t } from '../../i18n';

// Decor IDs map to nameDecor.<id> in translations
const DECOR_IDS = [
  { id: 'star_prefix',    labelKey: 'nameDecor.fx_star',      preview: (n) => `⭐ ${n}`,      costStars: 10, effect: null },
  { id: 'skull_prefix',   labelKey: 'nameDecor.fx_skull',     preview: (n) => `💀 ${n}`,      costStars: 10, effect: null },
  { id: 'fire_prefix',    labelKey: 'nameDecor.fx_fire',      preview: (n) => `🔥 ${n}`,      costStars: 10, effect: null },
  { id: 'crown_prefix',   labelKey: 'nameDecor.fx_crown',     preview: (n) => `👑 ${n}`,      costStars: 10, effect: null },
  { id: 'rocket_prefix',  labelKey: 'nameDecor.fx_rocket',    preview: (n) => `🚀 ${n}`,      costStars: 10, effect: null },
  { id: 'alien_prefix',   labelKey: 'nameDecor.fx_alien',     preview: (n) => `👾 ${n}`,      costStars: 10, effect: null },
  // Text effect wrappers
  { id: 'fx_brackets',    labelKey: 'nameDecor.br_commander', preview: (n) => `[${n}]`,       costStars: 10, effect: 'cyan' },
  { id: 'fx_slashes',     labelKey: 'nameDecor.br_hacker',    preview: (n) => `//${n}//`,     costStars: 10, effect: 'green' },
  { id: 'fx_admiral',     labelKey: 'nameDecor.br_admiral',   preview: (n) => `«${n}»`,       costStars: 10, effect: 'gold' },
  { id: 'fx_elite',       labelKey: 'nameDecor.br_elite',     preview: (n) => `★${n}★`,      costStars: 10, effect: 'purple' },
  { id: 'fx_legend',      labelKey: 'nameDecor.br_legend',    preview: (n) => `「${n}」`,     costStars: 10, effect: 'red' },
  { id: 'fx_code',        labelKey: 'nameDecor.br_ghost',     preview: (n) => `<<${n}>>`,     costStars: 10, effect: 'dim' },
  { id: 'fx_quantum',     labelKey: 'nameDecor.fx_quantum',   preview: (n) => `✶${n}✶`,       costStars: 0, costCrystals: 10000, effect: 'u2quantum' },
  // Ship-owner exclusive (free, auto-granted)
  { id: 'fx_captain',     labelKey: 'nameDecor.fx_captain',   preview: (n) => `⚓${n}⚓`,    costStars: 0,  effect: 'captain' },
];

// Getter returns decors with resolved labels
export function getNameDecors() {
  return DECOR_IDS.map(d => ({ ...d, label: t(d.labelKey) }));
}

// Keep NAME_DECORS as static for applyDecor (preview doesn't need label)
export const NAME_DECORS = DECOR_IDS;

export const DECOR_EFFECT_COLORS = {
  cyan:    '#06b6d4',
  green:   '#22c55e',
  gold:    '#fbbf24',
  purple:  '#a855f7',
  red:     '#ef4444',
  dim:     '#94a3b8',
  captain: '#06d6a0',
  u2quantum: '#7dffb3',
};

const HEADER_COLOR_IDS = [
  { id: 'blue',    color: '#1a1a4e', accent: '#4f8ef7' },
  { id: 'purple',  color: '#2d1458', accent: '#9c27b0' },
  { id: 'teal',    color: '#0d3333', accent: '#06b6d4' },
  { id: 'green',   color: '#0d3318', accent: '#22c55e' },
  { id: 'red',     color: '#3d0f0f', accent: '#ef4444' },
  { id: 'orange',  color: '#3d200a', accent: '#f59e0b' },
  { id: 'pink',    color: '#3d0f28', accent: '#ec4899' },
  { id: 'dark',    color: '#111120', accent: '#718096' },
];

export function getHeaderColors() {
  return HEADER_COLOR_IDS.map(c => ({ ...c, label: t(`headerColor.${c.id}`) }));
}
// Keep static export for backward compat
export const HEADER_COLORS = HEADER_COLOR_IDS;

const AVATAR_IDS = [
  { id: 'astronaut', icon: '🧑‍🚀' },
  { id: 'alien',     icon: '👾'    },
  { id: 'robot',     icon: '🤖'    },
  { id: 'pilot',     icon: '✈️'    },
  { id: 'wizard',    icon: '🧙'    },
  { id: 'ninja',     icon: '🥷'    },
  { id: 'skull',     icon: '💀'    },
  { id: 'ghost',     icon: '👻'    },
];

export function getAvatars() {
  return AVATAR_IDS.map(a => ({ ...a, label: t(`avatar.${a.id}`) }));
}
export const AVATARS = AVATAR_IDS;

export function applyDecor(name, decorId) {
  if (!decorId) return name;
  const d = NAME_DECORS.find((x) => x.id === decorId);
  return d ? d.preview(name) : name;
}
