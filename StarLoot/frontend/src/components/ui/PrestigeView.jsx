import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { CheckCircle, Circle, Lock, ChevronRight, AlertTriangle, Package, Trophy, Clock, TrendingUp, Zap, Sparkles } from 'lucide-react';
import { prestigeApi } from '../../services/api';
import { useGameStore } from '../../store/gameStore';
import { t } from '../../i18n';

// SVG diamond/star for prestige levels
function PrestigeStar({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 1L10 6.5H15.5L11 9.5L13 15L8 11.5L3 15L5 9.5L0.5 6.5H6L8 1Z" fill={color} />
    </svg>
  );
}

function PrestigeStars({ count, size = 14, color }) {
  const colors = { 1: '#a855f7', 2: '#f59e0b', 3: '#ec4899' };
  const c = color || colors[count] || 'currentColor';
  return (
    <span className="prestige-stars-row" aria-label={`${t('prestige.title')} ${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <PrestigeStar key={i} size={size} color={c} />
      ))}
    </span>
  );
}

const SCRAMBLE_CHARS = '!@#$%^&*_+{}[]<>?~=αβγδεζ01';
function ScrambleText({ length = 8, speed = 80 }) {
  const [text, setText] = useState(() =>
    Array.from({ length }, () => SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]).join('')
  );
  const timerRef = useRef(null);
  useEffect(() => {
    const tick = () => {
      setText(Array.from({ length }, () =>
        SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
      ).join(''));
      timerRef.current = setTimeout(tick, speed);
    };
    timerRef.current = setTimeout(tick, speed);
    return () => clearTimeout(timerRef.current);
  }, [length, speed]);
  return <span className="scramble-text" aria-hidden="true">{text}</span>;
}

const PRESTIGE_LABELS = [
  { level: 1, label: t('prestige.level1'), color: '#a855f7' },
  { level: 2, label: t('prestige.level2'), color: '#f59e0b' },
  { level: 3, label: t('prestige.level3'), color: '#ec4899' },
];

const REWARDS = [
  { Icon: Package,    key: 'rewardNft' },
  { Icon: Trophy,     key: 'rewardBanner' },
  { Icon: Clock,      key: 'rewardExpedition' },
  { Icon: TrendingUp, key: 'rewardSell' },
  { Icon: Zap,        key: 'rewardXp' },
];

function ConditionRow({ done, label, sub }) {
  return (
    <div className={`prestige-cond-row ${done ? 'prestige-cond--done' : ''}`}>
      <span className="prestige-cond-icon">
        {done ? <CheckCircle size={18} /> : <Circle size={18} />}
      </span>
      <span className="prestige-cond-text">
        <span className="prestige-cond-label">{label}</span>
        {sub && <span className="prestige-cond-sub">{sub}</span>}
      </span>
    </div>
  );
}

function ConfirmModal({ onConfirm, onCancel, loading }) {
  return (
    <div className="prestige-confirm-overlay" onClick={onCancel}>
      <div className="prestige-confirm-box" onClick={(e) => e.stopPropagation()}>
        <div className="prestige-confirm-icon">
          <AlertTriangle size={32} />
        </div>
        <h3 className="prestige-confirm-title">{t('prestige.confirmTitle')}</h3>
        <p className="prestige-confirm-text">{t('prestige.confirmText')}</p>
        <div className="prestige-confirm-btns">
          <button className="prestige-confirm-cancel" onClick={onCancel} disabled={loading}>
            {t('prestige.confirmNo')}
          </button>
          <button className="prestige-confirm-yes" onClick={onConfirm} disabled={loading}>
            {loading ? '...' : t('prestige.confirmYes')}
          </button>
        </div>
      </div>
    </div>
  );
}

const PrestigeView = memo(function PrestigeView({ user }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [success, setSuccess] = useState(false);
  const refreshUser = useGameStore((s) => s.loadUser);

  const userLevel = user?.level || 0;
  const showBlackMarket = userLevel >= 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await prestigeApi.getStatus();
      setStatus(res);
    } catch {
      setError(t('prestige.error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClaim = useCallback(async () => {
    setClaiming(true);
    try {
      await prestigeApi.claim();
      setSuccess(true);
      setConfirming(false);
      await refreshUser?.();
      await load();
    } catch (e) {
      setError(e?.message || t('prestige.error'));
      setConfirming(false);
    } finally {
      setClaiming(false);
    }
  }, [load, refreshUser]);

  if (loading) return <div className="prestige-loading"><span className="spinner" /></div>;
  if (error && !status) return <div className="prestige-error">{error}</div>;

  const currentPrestige = status?.prestigeLevel || 0;
  const maxPrestige = status?.maxPrestige;
  const eligible = status?.eligible;
  const cond = status?.conditions;

  const currentLabel = PRESTIGE_LABELS.find((p) => p.level === currentPrestige);
  const nextLabel = PRESTIGE_LABELS.find((p) => p.level === currentPrestige + 1);

  return (
    <div className="prestige-view">
      {/* Current prestige display */}
      <div className={`prestige-header ${currentPrestige > 0 ? `prestige-header--${currentPrestige}` : ''}`}>
        <div className="prestige-header-icon">
          {currentPrestige > 0
            ? <PrestigeStars count={currentPrestige} size={20} />
            : <PrestigeStar size={20} color="#4b5563" />}
        </div>
        <div className="prestige-header-info">
          <div className="prestige-header-title">{t('prestige.currentLevel')}</div>
          <div className="prestige-header-value">
            {currentPrestige > 0 ? currentLabel?.label : t('prestige.noPrestige')}
          </div>
        </div>
      </div>

      {success && (
        <div className="prestige-success-banner">
          <Sparkles size={16} />
          {t('prestige.success')}
        </div>
      )}

      {maxPrestige ? (
        <div className="prestige-max">
          <div className="prestige-max-icon">
            <PrestigeStars count={3} size={24} />
          </div>
          <p>{t('prestige.maxReached')}</p>
          <p className="prestige-max-sub">{t('prestige.maxSubtitle')}</p>
        </div>
      ) : (
        <>
          {nextLabel && (
            <div className="prestige-next-label">
              <PrestigeStars count={currentPrestige + 1} size={13} />
              <span>{nextLabel.label}</span>
              <ChevronRight size={14} />
            </div>
          )}

          {/* Rewards */}
          <div className="prestige-rewards">
            <div className="prestige-rewards-title">{t('prestige.rewards')}</div>
            {REWARDS.map(({ Icon, key }) => (
              <div key={key} className="prestige-reward-row">
                <Icon size={15} className="prestige-reward-icon" />
                <span>{t(`prestige.${key}`)}</span>
              </div>
            ))}
          </div>

          {/* Conditions */}
          {cond && (
            <div className="prestige-conditions">
              <div className="prestige-conditions-title">{t('prestige.conditions')}</div>

              <ConditionRow
                done={cond.level.done}
                label={t('prestige.condLevel', { required: cond.level.required })}
                sub={t('prestige.condLevelHint', { current: cond.level.current })}
              />

              <ConditionRow
                done={cond.modules.done}
                label={t('prestige.condModules')}
                sub={
                  !cond.modules.done
                    ? [
                        cond.modules.scanner.current < 10 ? t('prestige.condModulesScanner', { current: cond.modules.scanner.current }) : null,
                        cond.modules.cargo.current < 10   ? t('prestige.condModulesCargo',   { current: cond.modules.cargo.current })   : null,
                        cond.modules.capsule.current < 10 ? t('prestige.condModulesCapsule', { current: cond.modules.capsule.current }) : null,
                      ].filter(Boolean).join(' · ')
                    : null
                }
              />

              <ConditionRow
                done={cond.storyMissions.done}
                label={t('prestige.condStory')}
                sub={
                  !cond.storyMissions.done
                    ? [
                        !cond.storyMissions.signal ? t('prestige.condStorySignal') : null,
                        !cond.storyMissions.bio    ? t('prestige.condStoryBio')    : null,
                        !cond.storyMissions.tech   ? t('prestige.condStoryTech')   : null,
                        !cond.storyMissions.nav    ? t('prestige.condStoryNav')    : null,
                      ].filter(Boolean).join(' · ')
                    : null
                }
              />

              {showBlackMarket ? (
                <ConditionRow
                  done={cond.blackMarket.done}
                  label={t('prestige.condBlackMarket', {
                    current: cond.blackMarket.current,
                    required: cond.blackMarket.required,
                  })}
                />
              ) : (
                <div className="prestige-cond-row prestige-cond--hidden">
                  <span className="prestige-cond-icon"><Lock size={18} /></span>
                  <span className="prestige-cond-text">
                    <span className="prestige-cond-label prestige-cond-scramble">
                      <ScrambleText length={12} speed={70} />
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            className={`prestige-claim-btn ${eligible ? 'prestige-claim-btn--active' : 'prestige-claim-btn--locked'}`}
            onClick={() => eligible && setConfirming(true)}
            disabled={!eligible}
          >
            {eligible ? (
              <>
                <PrestigeStar size={16} color="currentColor" />
                {t('prestige.claimBtn')}
              </>
            ) : (
              <>
                <Lock size={16} />
                {t('prestige.claimBtnLocked')}
              </>
            )}
          </button>
        </>
      )}

      {confirming && (
        <ConfirmModal
          onConfirm={handleClaim}
          onCancel={() => setConfirming(false)}
          loading={claiming}
        />
      )}
    </div>
  );
});

export default PrestigeView;
