import { useEffect, useState, useMemo, memo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { tournamentApi } from '../../services/api';
import Modal from './Modal';
import { t } from '../../i18n';
import { MedalIcon, Hourglass, Gift } from '../../icons';

function getScoringLabels() { return t('tournament.scoring'); }

function useCountdown(endsAt) {
  const [remaining, setRemaining] = useState(() =>
    endsAt ? Math.max(0, new Date(endsAt) - Date.now()) : 0
  );
  useEffect(() => {
    if (!endsAt) { setRemaining(0); return; }
    const update = () => setRemaining(Math.max(0, new Date(endsAt) - Date.now()));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  return remaining;
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}

const TournamentPlayerRow = memo(function TournamentPlayerRow({ player, isMe, fmtScore }) {
  return (
    <div className={`lb-row ${isMe ? 'lb-row--me' : ''}`}>
      {player.rank <= 3
        ? <span className="lb-medal"><MedalIcon rank={player.rank} size={22} /></span>
        : <span className="lb-rank">#{player.rank}</span>
      }
      <div className="lb-name-wrap">
        <span className="lb-name">{player.name}</span>
        <span className="lb-level">{t('common.lvl')} {player.level}</span>
      </div>
      <span className="lb-xp">{fmtScore(player.score)}</span>
    </div>
  );
});

const TournamentLeaderboard = memo(function TournamentLeaderboard({ tournament, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tournamentApi.getLeaderboard(tournament.id)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [tournament.id]);

  const scoringLabel = getScoringLabels()[tournament.scoringType] || tournament.scoringType;
  const isWeight = tournament.scoringType?.startsWith('heaviest_');
  const fmtScore = (val) => {
    if (isWeight) {
      return val >= 1000 ? `${(val / 1000).toFixed(1)} ${t('units.t')}` : `${val} ${t('units.kg')}`;
    }
    return val.toLocaleString('ru-RU');
  };

  const meInTop = useMemo(() => {
    if (!data?.me || !data?.top) return true;
    return data.top.some((p) => p.userId === data.me.userId);
  }, [data]);

  return (
    <Modal open onClose={onClose} title={`${tournament.icon} ${tournament.title}`}>
      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
        {t('tournament.scoringLabel')} <strong>{scoringLabel}</strong>
        {tournament.prizeDescription && (
          <span> • <Gift size={12} style={{verticalAlign:'middle'}} /> {tournament.prizeDescription}</span>
        )}
      </div>

      {loading && (
        <div className="lb-loading"><span className="spinner" /></div>
      )}

      {!loading && data && (
        <div className="lb-list">
          {data.top.length === 0 && (
            <p style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
              {t('tournament.noParticipants')}
            </p>
          )}
          {data.top.map((player) => (
            <TournamentPlayerRow
              key={player.userId}
              player={player}
              isMe={data.me?.userId === player.userId}
              fmtScore={fmtScore}
            />
          ))}

          {data.me && !meInTop && (
            <>
              <div className="lb-divider">· · ·</div>
              <TournamentPlayerRow
                player={data.me}
                isMe
                fmtScore={fmtScore}
              />
            </>
          )}

          {data.me === null && (
            <p style={{ textAlign: 'center', padding: '8px 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              {t('tournament.joinHint')}
            </p>
          )}
        </div>
      )}

      <button className="btn btn-secondary lb-close" onClick={onClose}>{t('common.close')}</button>
    </Modal>
  );
});

export default memo(function TournamentBanner() {
  const tournament = useGameStore((s) => s.activeTournament);
  const loadActiveTournament = useGameStore((s) => s.loadActiveTournament);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const isPending = tournament ? new Date(tournament.startsAt) > Date.now() : false;
  const countdownTarget = isPending ? tournament?.startsAt : tournament?.endsAt;
  const remaining = useCountdown(countdownTarget);

  // Auto-refresh: when end timer hits 0 or when pending→active transition
  useEffect(() => {
    if (tournament && remaining === 0 && !isPending) {
      loadActiveTournament();
    }
    if (tournament && remaining === 0 && isPending) {
      loadActiveTournament();
    }
  }, [tournament, remaining, isPending, loadActiveTournament]);

  if (!tournament) return null;
  if (!isPending && remaining === 0) return null;

  return (
    <div className="event-banner-wrap">
      <button
        className={`event-btn tournament-btn${isPending ? ' tournament-pending' : ''}`}
        onClick={() => setShowLeaderboard(true)}
        title={tournament.title}
      >
        <span className="event-btn-icon">{isPending ? <Hourglass size={16} /> : tournament.icon}</span>
        <span className="event-btn-timer">
          {isPending ? t('tournament.pending') : formatCountdown(remaining)}
        </span>
      </button>

      {showLeaderboard && (
        isPending ? (
          <Modal open onClose={() => setShowLeaderboard(false)} title={`${tournament.icon} ${tournament.title}`}>
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}><Hourglass size={48} /></div>
              <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 8 }}>{t('tournament.startsIn')}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#ffc107', fontFamily: 'monospace' }}>{formatCountdown(remaining)}</div>
            </div>
            <button className="btn btn-secondary lb-close" onClick={() => setShowLeaderboard(false)}>{t('common.close')}</button>
          </Modal>
        ) : (
          <TournamentLeaderboard
            tournament={tournament}
            onClose={() => setShowLeaderboard(false)}
          />
        )
      )}
    </div>
  );
})
