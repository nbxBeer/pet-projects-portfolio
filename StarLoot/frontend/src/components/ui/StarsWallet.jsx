import { useState, useEffect, useRef, useCallback, memo } from 'react';
import Modal from './Modal';
import { userApi } from '../../services/api';
import { expeditionApi } from '../../services/api';
import { useTelegram } from '../../hooks/useTelegram';
import { useGameStore } from '../../store/gameStore';
import { t } from '../../i18n';
import { Star } from '../../icons';

const TOPUP_AMOUNTS = [10, 50, 100, 250, 500, 1000];

// Fetch bot username once globally (cached in module scope)
let _botUsernamePromise = null;
async function getBotUsername() {
  if (!_botUsernamePromise) {
    _botUsernamePromise = fetch('/api/bot-info')
      .then((r) => r.json())
      .then((d) => d.botUsername || null)
      .catch(() => null);
  }
  return _botUsernamePromise;
}

/**
 * StarsWallet — topup UI for Upgrades panel.
 * hideBalance=true hides balance row (balance shown in UserHeader instead).
 */
export default function StarsWallet({ compact = false, hideBalance = false }) {
  const [showTopup, setShowTopup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [botUsername, setBotUsername] = useState(null);
  const { openInvoice, haptic, showAlert } = useTelegram();
  const user = useGameStore((s) => s.user);
  const { updateStarsBalance } = useGameStore();

  useEffect(() => {
    getBotUsername().then(setBotUsername);
  }, []);

  const handleTopup = async (amount) => {
    setLoading(true);
    haptic.impact('medium');
    try {
      const { invoiceLink } = await userApi.createTopupInvoice(amount);
      setShowTopup(false);
      const status = await openInvoice(invoiceLink);
      if (status === 'paid') {
        haptic.notification('success');
        // Reload balance from server and update global store
        setTimeout(async () => {
          try {
            const data = await userApi.getStarsBalance();
            updateStarsBalance(data.starsBalance);
          } catch {}
        }, 1500);
        await showAlert(t('stars.topupSuccess', { amount }));
      } else if (status === 'cancelled') {
        haptic.notification('error');
      }
    } catch (err) {
      await showAlert(err.message || t('stars.topupError'));
    } finally {
      setLoading(false);
    }
  };

  if (compact) {
    return (
      <button
        className="stars-badge"
        onClick={() => setShowTopup(true)}
        title={t('stars.balanceTitle')}
      >
        {t('stars.balance')}
      </button>
    );
  }

  return (
    <>
      <div className="stars-wallet">
        {!hideBalance ? (
          <div className="stars-wallet-row">
            <span className="stars-label">{t('stars.balanceFull')}</span>
            <button className="btn-topup-mini" onClick={() => setShowTopup(true)}>
              {t('stars.topup')}
            </button>
          </div>
        ) : (
          <div className="stars-wallet-row stars-wallet-row--hero">
            <span className="stars-label stars-label--hero"><Star size={14} style={{verticalAlign:'middle',marginRight:4}} />{user?.starsBalance ?? 0}</span>
            <button className="btn-topup-mini btn-topup-mini--hero" onClick={() => setShowTopup(true)}>
              {t('stars.topup')}
            </button>
          </div>
        )}
      </div>

      {showTopup && (
        <TopupModal
          onSelect={handleTopup}
          onClose={() => setShowTopup(false)}
          loading={loading}
          botUsername={botUsername}
        />
      )}
    </>
  );
}

function TopupModal({ onSelect, onClose, loading, botUsername }) {
  const supportUrl = botUsername
    ? `https://t.me/${botUsername}?start=paysupport`
    : null;

  return (
    <Modal open onClose={onClose} title={t('stars.topupTitle')}>
      <p className="stars-topup-desc" style={{whiteSpace:'pre-line'}}>
        {t('stars.topupDesc')}
      </p>
      <div className="topup-grid">
        {TOPUP_AMOUNTS.map((amount) => (
          <button
            key={amount}
            className="topup-option"
            onClick={() => onSelect(amount)}
            disabled={loading}
          >
            <span className="topup-icon"><Star size={20} /></span>
            <span className="topup-amount">{amount}</span>
            <span className="topup-label">{t('stars.starsUnit')}</span>
          </button>
        ))}
      </div>
      <p className="stars-info">
        {t('stars.topupNote')}
      </p>
      <div className="stars-support-hint">
        {t('stars.paymentHelp')}{' '}
        {supportUrl ? (
          <span
            className="stars-support-link"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              try {
                window.Telegram?.WebApp?.openTelegramLink(supportUrl);
                // Close Mini App so user sees the bot chat (especially on mobile)
                setTimeout(() => {
                  try { window.Telegram?.WebApp?.close(); } catch {}
                }, 300);
              } catch {
                window.open(supportUrl, '_blank');
              }
            }}
          >
            {t('stars.contactSupport')}
          </span>
        ) : (
          <span>{t('stars.payCommandHint')}</span>
        )}
      </div>
    </Modal>
  );
}

/**
 * SpeedUpButton — shown during active expedition.
 * Spends Stars from wallet balance.
 */
export const SpeedUpButton = memo(function SpeedUpButton({ expeditionId, costStars = 1, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const busyUntil = useRef(0);
  const { haptic, showConfirm, showAlert } = useTelegram();
  const user = useGameStore((s) => s.user);
  const updateStarsBalance = useGameStore((s) => s.updateStarsBalance);
  const markExpeditionReady = useGameStore((s) => s.markExpeditionReady);

  const starsBalance = user?.starsBalance ?? null;

  // Telegram showConfirm with timeout — if callback never fires, resolve false after 6s
  const safeConfirm = useCallback((msg) => new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 6000);
    showConfirm(msg).then((v) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(v); }
    }).catch(() => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(false); }
    });
  }), [showConfirm]);

  // Telegram WebApp needs significant cooldown between popups (~2-3s)
  const POPUP_COOLDOWN = 2500;

  const handleSpeedup = useCallback(async () => {
    if (loading || Date.now() < busyUntil.current) return;

    if (starsBalance !== null && starsBalance < costStars) {
      busyUntil.current = Date.now() + POPUP_COOLDOWN;
      await showAlert(t('stars.speedUpNoStars', { cost: costStars, balance: starsBalance }));
      busyUntil.current = Date.now() + POPUP_COOLDOWN;
      return;
    }

    busyUntil.current = Date.now() + POPUP_COOLDOWN;
    const confirmed = await safeConfirm(
      t('stars.speedUpConfirm', { cost: costStars, balance: starsBalance ?? '?' })
    );
    busyUntil.current = Date.now() + POPUP_COOLDOWN;
    if (!confirmed) return;

    setLoading(true);
    haptic.impact('medium');
    try {
      const result = await expeditionApi.speedUp({ expeditionId });
      updateStarsBalance(result.starsRemaining);
      markExpeditionReady();
      onSuccess?.();
    } catch (err) {
      haptic.notification('error');
      busyUntil.current = Date.now() + POPUP_COOLDOWN;
      await showAlert(err.message || t('stars.speedUpError'));
      busyUntil.current = Date.now() + POPUP_COOLDOWN;
    } finally {
      setLoading(false);
    }
  }, [expeditionId, costStars, starsBalance]);

  return (
    <button
      className="btn btn-speedup btn-tap"
      onClick={handleSpeedup}
      disabled={loading}
    >
      {loading ? (
        <span className="spinner" />
      ) : (
        <>{t('stars.speedUp', { cost: costStars })}</>
      )}
    </button>
  );
})
