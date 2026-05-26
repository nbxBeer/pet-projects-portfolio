import { useEffect, useRef, useState, useMemo, memo, useCallback } from 'react';
import Modal from './Modal';
import { userApi } from '../../services/api';
import { useGameStore } from '../../store/gameStore';
import { applyDecor, NAME_DECORS, DECOR_EFFECT_COLORS } from './customizationCatalog';
import { t } from '../../i18n';

const DECOR_MAP = new Map(NAME_DECORS.map((d) => [d.id, d]));

function getDecorClass(decorId) {
  if (!decorId) return '';
  const d = DECOR_MAP.get(decorId);
  return d?.effect ? `decor-fx-${d.effect}` : '';
}

const CACHE_TTL = 5 * 60 * 1000;
const RANK_MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

const PRESTIGE_COLORS = { 1: '#a855f7', 2: '#f59e0b', 3: '#ec4899' };

function PrestigeBadge({ level }) {
  const color = PRESTIGE_COLORS[level] || '#a855f7';
  return (
    <span className="lb-prestige-icon" title={`${t('prestige.title')} ${level}`} aria-hidden="true" style={{ display: 'inline-flex', gap: 2 }}>
      {Array.from({ length: level }).map((_, i) => (
        <svg key={i} width={11} height={11} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1L10 6.5H15.5L11 9.5L13 15L8 11.5L3 15L5 9.5L0.5 6.5H6L8 1Z" fill={color} />
        </svg>
      ))}
    </span>
  );
}

const PlayerRow = memo(function PlayerRow({ entry, isMe }) {
  const pLevel = entry.prestigeLevel || 0;
  const prestigeClass = pLevel > 0 ? `lb-row--prestige lb-row--prestige-${pLevel}` : '';
  return (
    <div className={`lb-row ${isMe ? 'lb-row--me' : ''} ${prestigeClass}`}>
      {RANK_MEDALS[entry.rank]
        ? <span className="lb-medal">{RANK_MEDALS[entry.rank]}</span>
        : <span className="lb-rank">#{entry.rank}</span>
      }
      <div className="lb-name-wrap">
        <span className={`lb-name ${getDecorClass(entry.activeDecorId)}`}>{applyDecor(entry.name, entry.activeDecorId)}</span>
        {entry.achievement && (
          <span className="lb-badge" title={entry.achievement.name}>{entry.achievement.icon}</span>
        )}
        {pLevel > 0 && <PrestigeBadge level={pLevel} />}
      </div>
      <div className="lb-right">
        <span className="lb-level">{t('common.lvl')} {entry.level}</span>
        <span className="lb-xp">{Number(entry.value).toLocaleString()} XP</span>
      </div>
    </div>
  );
});

export default function LeaderboardModal({ onClose, embedded }) {
  const userId = useGameStore((s) => String(s.user?.id));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const cacheRef = useRef({ data: null, ts: 0 });

  useEffect(() => {
    async function load() {
      if (Date.now() - cacheRef.current.ts < CACHE_TTL && cacheRef.current.data) {
        setData(cacheRef.current.data);
        setLoading(false);
        return;
      }
      try {
        const res = await userApi.getLeaderboard('xp');
        cacheRef.current = { data: res, ts: Date.now() };
        setData(res);
      } catch (e) {
        setError(e.message || t('leaderboard.loadError'));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const { top, me, meInTop } = useMemo(() => {
    const topList = data?.top || [];
    const meEntry = data?.me;
    const inTop = meEntry ? topList.some((r) => r.userId === meEntry.userId) : true;
    return { top: topList, me: meEntry, meInTop: inTop };
  }, [data]);

  const content = (
    <>
      {loading && <div className="lb-loading"><span className="spinner" /></div>}
      {error && <div className="lb-error">{error}</div>}

      {!loading && !error && (
        <>
          <div className="lb-list">
            {top.map((entry) => (
              <PlayerRow
                key={entry.userId}
                entry={entry}
                isMe={entry.userId === userId}
              />
            ))}
          </div>

          {me && !meInTop && (
            <div className="lb-me-wrap">
              <div className="lb-divider">· · ·</div>
              <PlayerRow entry={me} isMe />
            </div>
          )}
        </>
      )}
    </>
  );

  if (embedded) return content;

  return (
    <Modal open onClose={onClose} title={t('leaderboard.title')}>
      {content}
      <button className="btn btn-secondary lb-close" onClick={onClose}>{t('common.close')}</button>
    </Modal>
  );
}
