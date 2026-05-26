import { useState, useEffect, memo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { userApi } from '../../services/api';
import { t } from '../../i18n';

export function ReferralEntryModal({ onDone }) {
  const [code, setCode] = useState('');
  const [tosChecked, setTosChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const setReferrer = useGameStore((s) => s.setReferrer);
  const user = useGameStore((s) => s.user);
  const setUser = (patch) => useGameStore.setState((s) => ({ user: { ...s.user, ...patch } }));

  const acceptTosSafe = async () => {
    if (typeof userApi.acceptTos === 'function') {
      return userApi.acceptTos(1);
    }

    const initData = window.Telegram?.WebApp?.initData;
    const res = await fetch('/api/user/accept-tos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(initData ? { 'X-Telegram-Init-Data': initData } : {}),
      },
      body: JSON.stringify({ version: 1 }),
    });

    let data = null;
    try {
      data = await res.json();
    } catch { }

    if (!res.ok) {
      throw new Error(data?.error || t('referralEntry.errors.acceptTos'));
    }

    return data;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) { setCode(ref); return; }

    const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (startParam && startParam.startsWith('ref_')) {
      setCode(startParam.slice(4));
      return;
    }

    if (user?.pendingReferrerId) {
      setCode(user.pendingReferrerId);
    }
  }, [user?.pendingReferrerId]);

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed || !tosChecked) return;
    if (user && String(trimmed) === String(user.id)) {
      setError(t('referral.ownCodeError'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (!user?.tosAccepted) {
        await acceptTosSafe();
        setUser({ tosAccepted: true, tosVersion: 1 });
      }
      await setReferrer(trimmed);
      localStorage.setItem(`ref_prompt_done_${user?.id}`, '1');
      onDone();
    } catch (err) {
      setError(err.message || t('referral.invalidCode'));
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    if (!tosChecked || loading) return;
    setLoading(true);
    setError(null);
    acceptTosSafe()
      .then(() => {
        setUser({ tosAccepted: true, tosVersion: 1 });
        localStorage.setItem(`ref_prompt_done_${user?.id}`, '1');
        onDone();
      })
      .catch((err) => {
        setError(err.message || t('referralEntry.errors.acceptTos'));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return (
    <div className="ref-entry-overlay">
      <div className="ref-entry-card">
        <div className="ref-entry-icon">🤝</div>
        <h2 className="ref-entry-title">{t('referral.codeLabel')}</h2>
        <p className="ref-entry-desc">{t('referral.friendInviteHint')}</p>
        <input
          className="ref-entry-input"
          type="text"
          inputMode="numeric"
          placeholder={t('referral.friendIdPlaceholder')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={loading}
        />
        {error && <div className="ref-entry-error">{error}</div>}
        <label className="ref-entry-consent">
          <input
            type="checkbox"
            checked={tosChecked}
            onChange={(e) => setTosChecked(e.target.checked)}
            disabled={loading}
          />
          <span>
            {t('referralEntry.tosPrefix')}{' '}
            <a
              href="https://telegra.ph/StarLoot-Terms-of-Service-03-27"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('referralEntry.tosLinkText')}
            </a>
          </span>
        </label>
        <button
          className="btn btn-collect ref-entry-btn"
          onClick={handleSubmit}
          disabled={loading || !code.trim() || !tosChecked}
        >
          {loading ? <span className="spinner" /> : t('referralEntry.confirm')}
        </button>
        <button className="btn btn-secondary ref-entry-skip" onClick={handleSkip} disabled={loading || !tosChecked}>
          {t('referralEntry.skip')}
        </button>
      </div>
    </div>
  );
}

const RANK_ICONS = ['🌑', '🌘', '🌗', '🌖', '🌕'];

const ReferralView = memo(function ReferralView({ showGuide }) {
  const referralStats = useGameStore((s) => s.referralStats);
  const loadReferralStats = useGameStore((s) => s.loadReferralStats);
  const claimMilestone = useGameStore((s) => s.claimMilestone);
  const claimActivationReward = useGameStore((s) => s.claimActivationReward);
  const user = useGameStore((s) => s.user);
  const [claiming, setClaiming] = useState(null);
  const [toast, setToast] = useState(null);
  const [botName, setBotName] = useState(window._botUsername || null);

  useEffect(() => { loadReferralStats(); }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2000); };

  useEffect(() => {
    if (window._botUsername) { setBotName(window._botUsername); return; }
    fetch('/api/bot-info').then(r => r.json()).then(d => {
      window._botUsername = d.botUsername;
      setBotName(d.botUsername);
    }).catch(() => {});
  }, []);

  if (!referralStats) {
    return <div className="center-spinner" style={{ minHeight: 200 }}><span className="spinner spinner-lg" /></div>;
  }

  const s = referralStats;
  const refLink = botName
    ? `https://t.me/${botName}?start=ref_${user?.id}`
    : `ref_${user?.id}`;

  const copyLink = () => {
    navigator.clipboard?.writeText(refLink).then(() => {
      showToast(t('referral.linkCopied'));
    }).catch(() => {
      showToast(refLink);
    });
  };

  const handleClaimMilestone = async (count) => {
    setClaiming(count);
    try {
      const res = await claimMilestone(count);
      if (res?.claimed) {
        showToast(`⭐ +${res.rewardStars} Stars!`);
      } else {
        showToast(res?.error || 'Error');
      }
    } catch (err) {
      showToast(err.message || 'Error');
    } finally {
      setClaiming(null);
    }
  };

  const handleClaimActivation = async () => {
    setClaiming('activation');
    try {
      const res = await claimActivationReward();
      if (res?.claimed) {
        showToast(`🪙 +${res.creditsReceived}!`);
        loadReferralStats();
      } else if (res?.pending) {
        const diff = new Date(res.availableAt) - Date.now();
        if (diff > 0) {
          const mins = Math.ceil(diff / 60000);
          showToast(t('referral.availableIn', { mins }));
        } else {
          showToast(t('referral.tryAgain'));
        }
      } else if (!res) {
        showToast(t('referral.bonusUnavailable'));
      }
    } catch {
      showToast('Error');
    } finally {
      setClaiming(null);
    }
  };

  const rankIcon = s.rankIndex >= 0 ? (RANK_ICONS[s.rankIndex] || '🌕') : '🌑';

  return (
    <div className="referral-view">
      {toast && <div className="ref-toast">{toast}</div>}

      {showGuide && (
        <div className="ref-guide">
          {t('referral.guide1')}<br/>
          {t('referral.guide2')}<br/>
          {t('referral.guide3')}<br/>
          {t('referral.guide4')}<br/>
          {t('referral.guide5')}
        </div>
      )}

      <div className="ref-section">
        <div className="ref-section-title">{t('referral.yourLink')}</div>
        <div className="ref-link-row">
          <input className="ref-link-input" value={refLink} readOnly />
          <button className="btn btn-sell ref-copy-btn" onClick={copyLink}>
            {t('referral.copy')}
          </button>
        </div>
        <div className="ref-code-hint">
          {t('referral.yourCode', { id: user?.id })}
        </div>
      </div>

      <div className="ref-section">
        <div className="ref-section-title">{t('referral.statistics')}</div>
        <div className="ref-stats-grid">
          <div className="ref-stat">
            <span className="ref-stat-value">{s.totalReferrals}</span>
            <span className="ref-stat-label">{t('referral.total')}</span>
          </div>
          <div className="ref-stat">
            <span className="ref-stat-value">{s.activeReferrals}</span>
            <span className="ref-stat-label">{t('referral.active')}</span>
          </div>
          <div className="ref-stat">
            <span className="ref-stat-value">{s.currentPercent}%</span>
            <span className="ref-stat-label">{t('referral.rate')}</span>
          </div>
          <div className="ref-stat">
            <span className="ref-stat-value">{rankIcon}</span>
            <span className="ref-stat-label">{t('referral.rank')}</span>
          </div>
        </div>
      </div>

      <div className="ref-section">
        <div className="ref-section-title">{t('referral.todayIncome')}</div>
        <div className="ref-income-row">
          <span>🪙 {s.todayCredits.toLocaleString()} / {s.todayCreditsLimit.toLocaleString()}</span>
          <span>⭐ {s.todayStars} / {s.todayStarsLimit}</span>
        </div>
        <div className="ref-alltime">
          {t('referral.allTimeEarned')}: 🪙 {s.allTimeCredits.toLocaleString()} · ⭐ {s.allTimeStars}
        </div>
      </div>

      {s.myReferrer && !s.myRewardClaimed && s.myActivated && (() => {
        const pending = s.myRewardPendingUntil && new Date(s.myRewardPendingUntil) > Date.now();
        const hasIncome = (s.todayCredits || 0) > 0 || (s.todayStars || 0) > 0;
        const canClaim = !pending && hasIncome;
        return (
          <div className="ref-section">
            <button
              className={`btn ${canClaim ? 'btn-collect' : 'btn-secondary'}`}
              style={{ width: '100%', opacity: canClaim ? 1 : 0.5 }}
              onClick={handleClaimActivation}
              disabled={claiming === 'activation' || !canClaim}
            >
              {claiming === 'activation'
                ? <span className="spinner" />
                : pending
                  ? t('referral.bonusNotReady')
                  : hasIncome
                    ? t('referral.claimBonus')
                    : t('referral.noIncomeToday')}
            </button>
          </div>
        );
      })()}

      <div className="ref-section">
        <div className="ref-section-title">{t('referral.milestones')}</div>
        <div className="ref-milestones">
          {s.milestones.map((m) => {
            const claimed = s.claimedMilestones.includes(m.count);
            const available = s.activeReferrals >= m.count && !claimed;
            return (
              <div key={m.count} className={`ref-milestone ${claimed ? 'claimed' : ''} ${available ? 'available' : ''}`}>
                <span className="ref-ms-count">{m.count} 👥</span>
                <span className="ref-ms-reward">⭐ {m.rewardStars}</span>
                {claimed && <span className="ref-ms-status">✅</span>}
                {available && (
                  <button
                    className="btn btn-sell ref-ms-btn"
                    onClick={() => handleClaimMilestone(m.count)}
                    disabled={claiming === m.count}
                  >
                    {claiming === m.count ? <span className="spinner" /> : t('referral.claim')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="ref-section">
        <div className="ref-section-title">{t('referral.ranks')}</div>
        <div className="ref-ranks">
          {s.ranks.map((r, i) => (
            <div key={r.min} className={`ref-rank-row ${i === s.rankIndex ? 'ref-rank-active' : ''} ${i < s.rankIndex ? 'ref-rank-done' : ''}`}>
              <span className="ref-rank-num">{i}</span>
              <span className="ref-rank-icon">{RANK_ICONS[i] || '🌕'}</span>
              <span className="ref-rank-info">
                {r.min}+ {t('referral.refAbbr')} → +{r.bonusPercent}%
              </span>
              <span className="ref-rank-cap">🪙 {r.creditsCap.toLocaleString()}/{t('referral.perDay')} · ⭐ {r.starsCap}/{t('referral.perDay')}</span>
            </div>
          ))}
        </div>
      </div>

      {s.referrals.length > 0 && (
        <div className="ref-section">
          <div className="ref-section-title">{t('referral.referralsList')}</div>
          <div className="ref-list">
            {s.referrals.map((r) => (
              <div key={r.id} className="ref-user-row">
                <span className="ref-user-name">{r.first_name || r.username || r.id}</span>
                <span className="ref-user-level">{t('common.lvl')} {r.level}</span>
                <span className={`ref-user-status ${r.referral_activated ? 'active' : 'pending'}`}>
                  {r.referral_activated ? t('referral.statusActive') : t('referral.statusPending')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default ReferralView;
