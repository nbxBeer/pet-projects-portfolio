import html2canvas from 'html2canvas';
import { t } from '../i18n';
import { localizeItemName } from '../i18n/entities';

const DEFAULT_BOT = 'StarLootGame_bot';

function rarityVoice(rarity) {
  const key = String(rarity || 'common').toLowerCase();
  const cap = key.charAt(0).toUpperCase() + key.slice(1);
  const titleKey = `share.voice${cap}Title`;
  const moodKey = `share.voice${cap}Mood`;
  const title = t(titleKey);
  if (title === titleKey) {
    return { title: t('share.voiceDefaultTitle'), mood: t('share.voiceDefaultMood') };
  }
  return { title, mood: t(moodKey) };
}

function formatRarityLabel(rarity) {
  const key = `rarity.${rarity || 'common'}`;
  const label = t(key);
  return String(label === key ? rarity || 'common' : label);
}

function getPreferredItemId(data = {}) {
  return data.resultId || data.result_id || data.inventoryItemId || data.id || null;
}

function buildBotLink(refUserId) {
  const username = window._botUsername || DEFAULT_BOT;
  if (refUserId) {
    return `https://t.me/${username}?start=ref_${refUserId}`;
  }
  return `https://t.me/${username}`;
}

function buildShareText({ rarity, itemName, sellPrice, refUserId, itemId }) {
  const voice = rarityVoice(rarity);
  const rarityLabel = formatRarityLabel(rarity);
  const formattedRarity = rarity === 'common' ? rarityLabel.toLowerCase() : rarityLabel.toUpperCase();
  const priceNum = Number(sellPrice);
  const priceLine = Number.isFinite(priceNum)
    ? `${t('share.price')}: ${priceNum.toLocaleString()} 🪙`
    : null;
  const idLine = itemId
    ? `${t('share.itemId')}: \`${String(itemId)}\``
    : null;

  const botLink = buildBotLink(refUserId);

  const lines = [
    voice.title,
    '',
    `🛰 ${itemName}`,
    `${t('share.rarity')}: ${formattedRarity}`,
    ...(priceLine ? [priceLine] : []),
    ...(idLine ? [idLine] : []),
    '',
    voice.mood,
    '',
    `[StarLoot](${botLink})`,
  ];

  return lines.join('\n');
}

export function buildResultShareText(result, sellPrice, options = {}) {
  const itemName = localizeItemName({
    objectData: result.objectData,
    templateId: result.objectData?.templateId,
    fallback: t('findResult.unknownObject'),
  });

  return buildShareText({
    rarity: result.rarity,
    itemName,
    sellPrice,
    refUserId: options.refUserId,
    itemId: getPreferredItemId(result),
  });
}

export function buildInventoryShareText(item, sellPrice, options = {}) {
  const itemName = localizeItemName({
    objectData: item.object_data,
    templateId: item.template_id,
    fallback: t('findResult.unknownObject'),
  });

  return buildShareText({
    rarity: item.rarity,
    itemName,
    sellPrice,
    refUserId: options.refUserId,
    itemId: getPreferredItemId(item),
  });
}

export async function captureCardImage(element) {
  if (!element) return null;
  const hiddenEls = element.querySelectorAll('.remote-scan-btn, .share-icon-btn');
  hiddenEls.forEach((el) => { el._prevDisplay = el.style.display; el.style.display = 'none'; });
  try {
    const canvas = await html2canvas(element, {
      backgroundColor: '#0f0f2a',
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  } finally {
    hiddenEls.forEach((el) => { el.style.display = el._prevDisplay || ''; });
  }
}
