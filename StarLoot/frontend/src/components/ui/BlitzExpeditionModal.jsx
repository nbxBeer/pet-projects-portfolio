import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { useGameStore } from '../../store/gameStore';
import { useTelegram } from '../../hooks/useTelegram';
import { t } from '../../i18n';
import { Zap, Shield, X, Check, Dna, AlertTriangle, Star } from '../../icons';
import { CoinIcon, CrystalIcon, ItemTypeIcon, RarityDot } from '../../icons';

const RARITY_COLOR = {
  common: '#9e9e9e', rare: '#2196f3', epic: '#9c27b0', legendary: '#ffc107',
  mythical: '#f44336', exotic: '#26c6da', ancient: '#8d6e63', relic: '#ff7043',
  hybrid: '#ab47bc', singularity: '#e040fb',
};

function dangerColor(c) {
  if (c <= 0 || c < 0.20) return '#22c55e';
  if (c < 0.40) return '#eab308';
  if (c < 0.65) return '#f97316';
  return '#f43f5e';
}

// ── Cooldown timer ────────────────────────────────────────────────────────────
function CooldownTimer({ cooldownUntil }) {
  const [rem, setRem] = useState(0);
  useEffect(() => {
    const tick = () => setRem(Math.max(0, new Date(cooldownUntil) - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);
  const h = Math.floor(rem / 3600000);
  const m = Math.floor((rem % 3600000) / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', fontSize: 28, color: '#f97316', letterSpacing: 2 }}>
      {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  );
}

// ── Swipeable card — memo prevents re-render on parent loading changes ────────
const BlitzCard = memo(function BlitzCard({ card, onContinue, onCashout, disabled }) {
  const dragX = useMotionValue(0);
  const rotate = useTransform(dragX, [-160, 160], [-14, 14]);
  const rightOpacity = useTransform(dragX, [20, 80], [0, 1]);
  const leftOpacity  = useTransform(dragX, [-80, -20], [1, 0]);
  const color = RARITY_COLOR[card?.rarity] || '#9e9e9e';

  const handleDragEnd = useCallback((_, info) => {
    if (disabled) return;
    dragX.set(0);
    if (info.offset.x > 80)       onContinue();
    else if (info.offset.x < -80) onCashout();
  }, [disabled, onContinue, onCashout, dragX]);

  if (!card) return null;

  return (
    <div style={{ position: 'relative', width: 260, height: 320, margin: '0 auto' }}>
      {/* Left overlay */}
      <motion.div style={{
        position: 'absolute', inset: 0, borderRadius: 20, zIndex: 10,
        background: 'rgba(239,68,68,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: leftOpacity, pointerEvents: 'none',
      }}>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 22, letterSpacing: 2, transform: 'rotate(-10deg)' }}>
          <X size={20} style={{ verticalAlign: 'middle', marginRight: 6 }} />{t('blitz.exitOverlay')}
        </span>
      </motion.div>

      {/* Right overlay */}
      <motion.div style={{
        position: 'absolute', inset: 0, borderRadius: 20, zIndex: 10,
        background: 'rgba(34,197,94,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: rightOpacity, pointerEvents: 'none',
      }}>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 22, letterSpacing: 2, transform: 'rotate(10deg)' }}>
          {t('blitz.takeOverlay')} <Check size={20} style={{ verticalAlign: 'middle', marginLeft: 6 }} />
        </span>
      </motion.div>

      {/* Card body */}
      <motion.div
        drag={disabled ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.25}
        onDragEnd={handleDragEnd}
        style={{
          x: dragX, rotate,
          position: 'absolute', inset: 0,
          background: 'var(--bg-card)',
          borderRadius: 20,
          border: `2px solid ${color}`,
          boxShadow: `0 0 20px ${color}44, 0 4px 16px rgba(0,0,0,0.4)`,
          cursor: disabled ? 'default' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
          willChange: 'transform',
        }}
      >
        <div style={{ height: 4, borderRadius: '18px 18px 0 0', background: color, opacity: 0.85 }} />
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', height: 'calc(100% - 4px)', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RarityDot color={RARITY_COLOR[card.rarity]} size={10} />
            <span style={{ color, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.5 }}>
              {t(`rarity.${card.rarity}`) || card.rarity}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
            <div style={{
              width: 72, height: 72, borderRadius: 16,
              background: `${color}22`, border: `1.5px solid ${color}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ItemTypeIcon type={card.findType} size={38} color={color} />
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.3 }}>
              {card.name}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {card.currency === 'crystals'
                ? <CrystalIcon size={14} color="#26c6da" />
                : <CoinIcon size={14} color="#f59e0b" />}
              <span style={{ fontWeight: 700, color: card.currency === 'crystals' ? '#26c6da' : '#f59e0b', fontSize: 15, fontFamily: 'var(--font-mono)' }}>
                +{card.creditsValue?.toLocaleString()}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dna size={14} color="var(--accent-blue)" />
              <span style={{ color: 'var(--accent-blue)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                +{card.xpValue} XP
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
});

// ── Risk meter ────────────────────────────────────────────────────────────────
function RiskMeter({ chance, stabilizerSwipesRemaining }) {
  const protected_ = stabilizerSwipesRemaining > 0;
  const fill  = Math.min(chance, 1);
  const color = dangerColor(chance);
  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={13} color={protected_ ? '#22c55e' : color} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{t('blitz.explosionChance')}</span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: protected_ ? '#22c55e' : color }}>
          {protected_ ? '0%' : `${Math.round(chance * 100)}%`}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <motion.div
          animate={{ width: protected_ ? '100%' : `${fill * 100}%` }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          style={{
            height: '100%', borderRadius: 4,
            background: protected_ ? 'linear-gradient(90deg,#22c55e,#16a34a)'
              : fill < 0.4 ? `linear-gradient(90deg,#22c55e,${color})`
              : `linear-gradient(90deg,#eab308,${color})`,
          }}
        />
      </div>
      {protected_ && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
          <Shield size={11} color="#22c55e" />
          <span style={{ fontSize: 11, color: '#22c55e' }}>
            {t('blitz.stabilizer', { swipes: stabilizerSwipesRemaining })}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function BlitzExpeditionModal({ onClose }) {
  const { haptic, showAlert } = useTelegram();

  // Granular selectors — each re-renders only when its slice changes
  const session       = useGameStore((s) => s.blitz.session);
  const cooldownUntil = useGameStore((s) => s.blitz.cooldownUntil);
  const loading       = useGameStore((s) => s.blitz.loading);
  const result        = useGameStore((s) => s.blitz.result);
  const cardKey       = useGameStore((s) => s.blitz.cardKey);
  const selectedZoneId = useGameStore((s) => s.selectedZoneId);
  const zones          = useGameStore((s) => s.zones);

  const startBlitzSession = useGameStore((s) => s.startBlitzSession);
  const continueBlitz     = useGameStore((s) => s.continueBlitz);
  const cashoutBlitz      = useGameStore((s) => s.cashoutBlitz);
  const sellBlitzCashout  = useGameStore((s) => s.sellBlitzCashout);
  const keepBlitzCashout  = useGameStore((s) => s.keepBlitzCashout);
  const clearBlitzResult  = useGameStore((s) => s.clearBlitzResult);
  const loadBlitzStatus   = useGameStore((s) => s.loadBlitzStatus);
  const skipBlitzCooldown = useGameStore((s) => s.skipBlitzCooldown);

  const [showDetonation, setShowDetonation] = useState(false);
  const detonationRef = useRef(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => { loadBlitzStatus(); }, []);

  useEffect(() => {
    if (result?.type === 'detonated' && !detonationRef.current) {
      detonationRef.current = true;
      setShowDetonation(true);
      haptic.notification('error');
      setTimeout(() => setShowDetonation(false), 900);
    }
    if (result?.type === 'cashout') haptic.notification('success');
    if (!result) detonationRef.current = false;
  }, [result]);

  // Use getState() inside callbacks — no stale closure, stable references
  const handleStart = useCallback(async () => {
    const { selectedZoneId: zId, zones: zs } = useGameStore.getState();
    const zoneId = zId || zs[0]?.id;
    if (!zoneId) return;
    haptic.impact('medium');
    try {
      await startBlitzSession(zoneId);
    } catch (err) {
      if (!err.cooldownUntil) await showAlert(err.message || t('blitz.startError'));
    }
  }, [startBlitzSession]);

  const handleContinue = useCallback(async () => {
    const { blitz } = useGameStore.getState();
    if (blitz.loading || !blitz.session) return;
    haptic.impact('heavy');
    try {
      await continueBlitz(blitz.session.sessionId);
    } catch (err) {
      await showAlert(err.message || t('blitz.error'));
    }
  }, [continueBlitz]);

  const handleCashout = useCallback(async () => {
    const { blitz } = useGameStore.getState();
    if (blitz.loading || !blitz.session) return;
    haptic.impact('medium');
    try {
      await cashoutBlitz(blitz.session.sessionId);
    } catch (err) {
      await showAlert(err.message || t('blitz.error'));
    }
  }, [cashoutBlitz]);

  const handleSkipCooldown = useCallback(async () => {
    if (useGameStore.getState().blitz.loading) return;
    haptic.impact('medium');
    try {
      await skipBlitzCooldown();
      haptic.notification('success');
    } catch (err) {
      await showAlert(err.message || t('blitz.error'));
    }
  }, [skipBlitzCooldown]);

  const handleSellCashout = useCallback(async () => {
    if (!result?.sessionId || useGameStore.getState().blitz.loading) return;
    haptic.impact('medium');
    try {
      await sellBlitzCashout(result.sessionId);
      haptic.notification('success');
    } catch (err) {
      await showAlert(err.message || t('blitz.error'));
    }
  }, [result?.sessionId, sellBlitzCashout]);

  const handleKeepCashout = useCallback(async () => {
    if (!result?.sessionId || useGameStore.getState().blitz.loading) return;
    haptic.impact('medium');
    try {
      await keepBlitzCashout(result.sessionId);
      haptic.notification('success');
    } catch (err) {
      await showAlert(err.message || t('blitz.error'));
    }
  }, [result?.sessionId, keepBlitzCashout]);

  const onCooldown = cooldownUntil && new Date(cooldownUntil) > new Date();

  // ── Detonation flash ──────────────────────────────────────────────────────
  const detonationOverlay = showDetonation && (
    <motion.div
      initial={{ opacity: 0.85 }} animate={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(239,68,68,0.7)', pointerEvents: 'none' }}
    />
  );

  // ── Result screen ─────────────────────────────────────────────────────────
  if (result) {
    const isCashout = result.type === 'cashout';
    const items = isCashout ? (result.items || []) : (result.lostItems || []);
    return createPortal((
      <>
        {detonationOverlay}
        <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && clearBlitzResult()}>
          <motion.div
            initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={S.sheet}
          >
            <div style={S.header}>
              <span style={{ fontWeight: 800, fontSize: 16 }}>
                {isCashout ? t('blitz.lootCollected') : t('blitz.engineDetonation')}
              </span>
              <button onClick={clearBlitzResult} style={S.closeBtn}><X size={18} /></button>
            </div>

            <div style={{
              borderRadius: 14, padding: 16, marginBottom: 12,
              background: isCashout ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1.5px solid ${isCashout ? '#22c55e44' : '#ef444444'}`,
              textAlign: 'center',
            }}>
              {isCashout ? (
                <>
                  <Check size={36} color="#22c55e" style={{ marginBottom: 4 }} />
                  <div style={{ color: '#22c55e', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
                    {t('blitz.cardsCollected', { count: result.itemCount })}
                  </div>
                  <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                    {(result.totalCredits || 0) > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#f59e0b', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        <CoinIcon size={15} /> {result.totalCredits?.toLocaleString()}
                      </span>
                    )}
                    {(result.totalCrystals || 0) > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#26c6da', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        <CrystalIcon size={15} /> {result.totalCrystals?.toLocaleString()}
                      </span>
                    )}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>
                      <Dna size={14} /> +{result.totalXP} XP
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle size={36} color="#ef4444" style={{ marginBottom: 4 }} />
                  <div style={{ color: '#ef4444', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{t('blitz.engineExploded')}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {t('blitz.cardsLost', { count: result.lostCount || 0 })}
                    {result.lostCredits > 0 && (
                      <span style={{ color: '#ef4444', marginLeft: 4 }}>
                        ({result.lostCredits?.toLocaleString()} <CoinIcon size={11} style={{ verticalAlign: 'middle' }} />)
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {items.length > 0 && (
              <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {items.map((item, i) => {
                  const c = RARITY_COLOR[item.rarity] || '#9e9e9e';
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 10,
                      background: 'var(--bg-elevated)', border: `1px solid ${c}33`,
                    }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${c}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <ItemTypeIcon type={item.findType} size={18} color={c} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: isCashout ? '#f59e0b' : '#ef4444', fontFamily: 'var(--font-mono)' }}>
                          {isCashout ? '+' : '-'}{item.creditsValue} {item.currency === 'crystals'
                            ? <CrystalIcon size={10} style={{ verticalAlign: 'middle' }} />
                            : <CoinIcon size={10} style={{ verticalAlign: 'middle' }} />}
                        </div>
                      </div>
                      <RarityDot color={c} size={8} />
                    </div>
                  );
                })}
              </div>
            )}

            {isCashout && (
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleKeepCashout} disabled={loading} style={{ ...S.btnPrimary, background: 'linear-gradient(135deg, var(--accent-gold), #f59e0b)', flex: 1, opacity: loading ? 0.5 : 1 }}>
                  {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : t('blitz.keep')}
                </button>
                <button onClick={handleSellCashout} disabled={loading} style={{ ...S.btnPrimary, background: 'linear-gradient(135deg, var(--accent-blue), #4f8ef7)', flex: 1, opacity: loading ? 0.5 : 1 }}>
                  {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : t('blitz.sell')}
                </button>
              </div>
            )}
            {!isCashout && <button onClick={clearBlitzResult} style={{ ...S.btnPrimary, background: '#ef4444' }}>
              {isCashout ? t('blitz.great') : t('blitz.ok')}
            </button>}
          </motion.div>
        </div>
      </>
    ), document.body);
  }

  // ── Active session ────────────────────────────────────────────────────────
  if (session) {
    return createPortal((
      <>
        {detonationOverlay}
        <div style={S.overlay}>
          <div style={{ ...S.sheet, paddingBottom: 'calc(20px + var(--safe-bottom))' }}>
            {/* Header */}
            <div style={{ ...S.header, marginBottom: 12 }}>
              <span style={{ fontWeight: 800, fontSize: 15 }}>{t('blitz.title')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {session.accumulatedCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20, padding: '3px 10px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>{session.accumulatedCount}×</span>
                    <CoinIcon size={12} color="#f59e0b" />
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#f59e0b', fontSize: 12 }}>{session.accumulatedCredits?.toLocaleString()}</span>
                  </div>
                )}
                <button onClick={onClose} style={S.closeBtn}><X size={18} /></button>
              </div>
            </div>

            <RiskMeter chance={session.explosionChance} stabilizerSwipesRemaining={session.stabilizerSwipesRemaining || 0} />

            <div style={{ height: 18 }} />

            {/* Card area — overflow hidden prevents horizontal scrollbar from drag */}
            <div style={{ overflow: 'hidden', margin: '0 -4px', padding: '0 4px' }}>
              <motion.div
                key={cardKey}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                <BlitzCard
                  card={session.card}
                  onContinue={handleContinue}
                  onCashout={handleCashout}
                  disabled={loading}
                />
              </motion.div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, padding: '0 8px' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('blitz.exitWithLoot')}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('blitz.takeAndContinue')}</span>
            </div>

            <div style={{ height: 16 }} />

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleCashout} disabled={loading}
                style={{ ...S.btnSecondary, flex: 1, borderColor: '#ef4444', color: '#ef4444', opacity: loading ? 0.5 : 1 }}
              >
                {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <><X size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />{t('blitz.exit')}</>}
              </button>
              <button
                onClick={handleContinue} disabled={loading}
                style={{ ...S.btnPrimary, flex: 1.4, opacity: loading ? 0.5 : 1 }}
              >
                {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <><Zap size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />{t('blitz.risk')}</>}
              </button>
            </div>

            <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              {t('blitz.swipeHint')}
            </p>
          </div>
        </div>
      </>
    ), document.body);
  }

  // ── Idle / Cooldown ───────────────────────────────────────────────────────
  return createPortal((
    <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div
        initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        style={S.sheet}
      >
        <div style={S.header}>
          <span style={{ fontWeight: 800, fontSize: 16 }}>{t('blitz.title')}</span>
          <button onClick={onClose} style={S.closeBtn}><X size={18} /></button>
        </div>

        <div style={{ borderRadius: 14, padding: 14, background: 'var(--bg-elevated)', marginBottom: 20, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p>{t('blitz.intro1')}</p>
          <p style={{ marginTop: 6 }}><span style={{ color: '#22c55e' }}>{t('blitz.swipeRight')}</span> {t('blitz.intro2')}</p>
          <p style={{ marginTop: 4 }}><span style={{ color: '#ef4444' }}>{t('blitz.swipeLeft')}</span> {t('blitz.intro3')}</p>
          <p style={{ marginTop: 6, color: '#f97316' }}>{t('blitz.intro4')}</p>
          <p style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11 }}>{t('blitz.intro5')}</p>
        </div>

        {onCooldown ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 10, fontSize: 13 }}>{t('blitz.recharging')}</p>
            <CooldownTimer cooldownUntil={cooldownUntil} />
            <button
              onClick={handleSkipCooldown} disabled={loading}
              style={{ ...S.btnSecondary, width: '100%', marginTop: 16, borderColor: '#f59e0b', color: '#f59e0b', opacity: loading ? 0.5 : 1 }}
            >
              {loading
                ? <span className="spinner" style={{ width: 14, height: 14 }} />
                : <><Star size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{t('blitz.skipCooldown')}</>}
            </button>
          </div>
        ) : (
          <button onClick={handleStart} disabled={loading} style={{ ...S.btnPrimary, width: '100%' }}>
            {loading
              ? <span className="spinner" style={{ width: 16, height: 16 }} />
              : <><Zap size={16} style={{ verticalAlign: 'middle', marginRight: 8 }} />{t('blitz.start')}</>}
          </button>
        )}
      </motion.div>
    </div>
  ), document.body);
}

const S = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, height: 'var(--tg-vh, 100vh)', zIndex: 1200,
    background: 'rgba(0,0,0,0.75)',   // no backdropFilter — kills mobile perf
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    paddingBottom: 'var(--safe-bottom)',
  },
  sheet: {
    width: '100%', maxWidth: 420,
    background: 'var(--bg-secondary)',
    borderRadius: '24px 24px 0 0',
    padding: '20px 18px calc(28px + var(--safe-bottom))',
    boxShadow: '0 -4px 24px rgba(168,85,247,0.15)',
    border: '1px solid var(--border)',
    borderBottom: 'none',
    maxHeight: 'calc(var(--tg-vh, 100vh) - 12px)',
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  closeBtn: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '6px 8px', color: 'var(--text-secondary)',
    cursor: 'pointer', display: 'flex', alignItems: 'center',
  },
  btnPrimary: {
    background: 'linear-gradient(135deg, var(--accent-violet), var(--accent-purple))',
    color: '#fff', border: 'none', borderRadius: 14,
    padding: '13px 20px', fontSize: 15, fontWeight: 700,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-display)',
  },
  btnSecondary: {
    background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1.5px solid var(--border)', borderRadius: 14,
    padding: '13px 20px', fontSize: 15, fontWeight: 700,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-display)',
  },
};
