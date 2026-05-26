'use strict';

const { query } = require('../db/pool');

// ── Static dialog definitions ─────────────────────────────────────────────────
// Add new factions here. Each dialog appears once when rep threshold is reached.
const DIALOG_CONFIGS = [
  {
    id: 'nav_dialog_01_intro',
    factionId: 'navigators_order',
    requiredRep: 500,
    // Guard: don't show if player already has the story item (quest already done)
    absentStoryItem: 'particle_decelerator',
    npc: {
      id: 'commander_viriana',
      nameRu: 'Командир Вирьяна',
      nameEn: 'Commander Viriana',
      titleRu: 'Орден навигаторов · Старший навигатор',
      titleEn: 'Navigators Order · Senior Navigator',
    },
    nodes: [
      {
        id: 'intro',
        textRu: 'Навигатор. Орден внимательно следит за вашими экспедициями. Вы доказали, что пустота вам не страшна. Есть задание — не из простых.',
        textEn: 'Navigator. The Order has been monitoring your expeditions closely. You have proven that the void holds no fear for you. There is a mission — not an easy one.',
        choices: [
          { id: 'ask', labelRu: 'Что за задание?', labelEn: 'What kind of mission?', next: 'detail' },
          { id: 'accept', labelRu: 'Я готов.', labelEn: 'I\'m ready.', next: 'end_accept', markSeen: true },
          { id: 'later', labelRu: 'Не сейчас.', labelEn: 'Not now.', next: null, markSeen: false },
        ],
      },
      {
        id: 'detail',
        textRu: 'Мы обнаружили артефакт — Замедлитель частиц. Он способен искривлять поток времени вокруг судна. Нужно изучить его на практике: провести серию ускоренных экспедиций под наблюдением Ордена. Взамен — артефакт ваш.',
        textEn: 'We have located an artifact — the Particle Decelerator. It bends the temporal flow around a vessel. We need you to test it in the field: run a series of accelerated expeditions under Order supervision. In return — the artifact is yours.',
        choices: [
          { id: 'accept_after', labelRu: 'Принять задание.', labelEn: 'Accept the mission.', next: 'end_accept', markSeen: true },
          { id: 'later_after', labelRu: 'Мне нужно подумать.', labelEn: 'I need to think.', next: null, markSeen: false },
        ],
      },
      {
        id: 'end_accept',
        textRu: 'Отлично, навигатор. Задание уже в вашем журнале. Орден рассчитывает на вас.',
        textEn: 'Excellent, navigator. The mission is already in your log. The Order is counting on you.',
        choices: [],
      },
    ],
  },
  {
    id: 'tech_dialog_01_intro',
    factionId: 'tech_institute',
    requiredRep: 444,
    absentStoryItem: 'exhibition_pass',
    npc: {
      id: 'director_vael',
      nameRu: 'Директор Вэль',
      nameEn: 'Director Vael',
      titleRu: 'Технологический институт · Главный куратор',
      titleEn: 'Technology Institute · Chief Curator',
    },
    nodes: [
      {
        id: 'intro',
        textRu: 'Пилот. Ваша репутация в Институте говорит сама за себя. Мы хотели бы предложить вам нечто особенное — но сначала докажите, что вы достойны этого.',
        textEn: 'Pilot. Your reputation with the Institute speaks for itself. We would like to offer you something special — but first, prove you are worthy.',
        choices: [
          { id: 'ask',    labelRu: 'Что нужно доказать?', labelEn: 'What must I prove?',  next: 'detail' },
          { id: 'accept', labelRu: 'Я готов.',             labelEn: 'I\'m ready.',          next: 'end_accept', markSeen: true },
          { id: 'later',  labelRu: 'Позже.',               labelEn: 'Later.',               next: null, markSeen: false },
        ],
      },
      {
        id: 'detail',
        textRu: 'В глубинах пространства — в обеих вселенных — блуждает Божественный осколок. Реликвия цивилизации, которой больше нет. Найдите его в дальней экспедиции и передайте нам. Взамен — доступ к нашей закрытой галерее. Ваши артефакты смогут выставляться, а зрители будут платить.',
        textEn: 'In the depths of space — across both universes — drifts the Divine Shard. A relic of a civilization that no longer exists. Find it on a long expedition and bring it to us. In return — access to our private gallery. Your artifacts will be exhibited, and viewers will pay.',
        choices: [
          { id: 'accept_after', labelRu: 'Принять задание.', labelEn: 'Accept.',         next: 'end_accept', markSeen: true },
          { id: 'later_after',  labelRu: 'Нужно подумать.', labelEn: 'I need to think.', next: null, markSeen: false },
        ],
      },
      {
        id: 'end_accept',
        textRu: 'Ожидаем вашего возвращения. Задание в вашем журнале. Удачи в экспедиции, пилот.',
        textEn: 'We await your return. The mission is in your log. Good luck on the expedition, pilot.',
        choices: [],
      },
    ],
  },
  {
    id: 'bio_dialog_01_intro',
    factionId: 'bioengineers',
    requiredRep: 400,
    absentStoryItem: 'gene_enhancer',
    npc: {
      id: 'dr_selara',
      nameRu: 'Д-р Селара',
      nameEn: 'Dr. Selara',
      titleRu: 'Биоинженеры · Главный генетик',
      titleEn: 'Bioengineers · Chief Geneticist',
    },
    nodes: [
      {
        id: 'intro',
        textRu: 'Пилот. Наши датчики фиксируют богатую биосигнатуру вашего судна. Вы понимаете толк в существах пустоты. У меня есть предложение.',
        textEn: 'Pilot. Our sensors are picking up a rich biosignature from your vessel. You understand void creatures. I have a proposal.',
        choices: [
          { id: 'ask',    labelRu: 'Что за предложение?', labelEn: 'What proposal?',    next: 'detail' },
          { id: 'accept', labelRu: 'Я слушаю.',           labelEn: 'I\'m listening.',   next: 'end_accept', markSeen: true },
          { id: 'later',  labelRu: 'Позже.',              labelEn: 'Later.',            next: null, markSeen: false },
        ],
      },
      {
        id: 'detail',
        textRu: 'Нам нужен живой образец — целая экосистема. Соберите двадцать существ в инвентаре одновременно, и мы передадим вам Генный усилитель: устройство, повышающее редкость существ прямо в момент поимки.',
        textEn: 'We need a living sample — a whole ecosystem. Collect twenty creatures in your inventory simultaneously, and we will give you the Gene Enhancer: a device that upgrades creature rarity at the moment of capture.',
        choices: [
          { id: 'accept_after', labelRu: 'Принять задание.', labelEn: 'Accept.',          next: 'end_accept', markSeen: true },
          { id: 'later_after',  labelRu: 'Нужно время.',     labelEn: 'I need time.',     next: null, markSeen: false },
        ],
      },
      {
        id: 'end_accept',
        textRu: 'Превосходно. Задание активировано. Все двадцать существ должны быть в трюме одновременно.',
        textEn: 'Excellent. Mission activated. All twenty creatures must be in the hold simultaneously.',
        choices: [],
      },
    ],
  },
];

class StoryDialogService {
  // ── Get dialog configs pending for a user ──────────────────────────────────
  getPendingDialogs(reputations, seenDialogIds, ownedStoryItems) {
    return DIALOG_CONFIGS.filter(d => {
      const rep = reputations[d.factionId] || 0;
      if (rep < d.requiredRep) return false;
      if (seenDialogIds.has(d.id)) return false;
      if (d.absentStoryItem && ownedStoryItems.has(d.absentStoryItem)) return false;
      return true;
    });
  }

  // ── Get set of dialog IDs already seen by a user ──────────────────────────
  async getSeenDialogIds(userId) {
    const rows = await query(
      'SELECT dialog_id FROM user_story_dialog_progress WHERE user_id = $1',
      [userId]
    );
    return new Set(rows.rows.map(r => r.dialog_id));
  }

  // ── Get set of story item keys owned by user ──────────────────────────────
  async getOwnedStoryItems(userId) {
    const rows = await query(
      'SELECT item_key FROM user_story_items WHERE user_id = $1',
      [userId]
    );
    return new Set(rows.rows.map(r => r.item_key));
  }

  // ── Mark a dialog as seen (accepted by player) ────────────────────────────
  async markDialogSeen(userId, dialogId) {
    await query(
      `INSERT INTO user_story_dialog_progress (user_id, dialog_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, dialog_id) DO NOTHING`,
      [userId, dialogId]
    );
  }
}

module.exports = StoryDialogService;
