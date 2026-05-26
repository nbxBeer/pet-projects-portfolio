import { useEffect, useState, useCallback } from 'react';

/**
 * useTelegram — central hook for all Telegram WebApp SDK interactions.
 * Handles initialization, theming, back button, main button, and haptic feedback.
 */
export function useTelegram() {
  const tg = window.Telegram?.WebApp;
  const [isReady, setIsReady] = useState(false);
  const [colorScheme, setColorScheme] = useState('dark');

  useEffect(() => {
    const setVh = (h) => {
      const safeHeight = Math.max(320, Math.round(Number(h) || window.innerHeight || 0));
      document.documentElement.style.setProperty('--tg-vh', `${safeHeight}px`);
    };

    const browserViewportHeight = () => (
      window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight
    );

    const bindBrowserViewport = (handler) => {
      window.addEventListener('resize', handler);
      window.visualViewport?.addEventListener?.('resize', handler);
      window.visualViewport?.addEventListener?.('scroll', handler);
      return () => {
        window.removeEventListener('resize', handler);
        window.visualViewport?.removeEventListener?.('resize', handler);
        window.visualViewport?.removeEventListener?.('scroll', handler);
      };
    };

    if (!tg) {
      console.warn('Telegram WebApp SDK not found, running in standalone mode');
      const onResize = () => setVh(browserViewportHeight());
      onResize();
      const cleanupViewport = bindBrowserViewport(onResize);
      setIsReady(true);
      return cleanupViewport;
    }

    // Expand to fullscreen
    tg.expand();
    tg.ready();

    // Apply Telegram color scheme
    setColorScheme(tg.colorScheme || 'dark');

    // Set header color to match game theme
    tg.setHeaderColor('#0a0a1a');
    tg.setBackgroundColor('#0a0a1a');

    const handleThemeChanged = () => {
      setColorScheme(tg.colorScheme);
    };
    tg.onEvent('themeChanged', handleThemeChanged);

    // Track the currently visible viewport; Android stableHeight can include bottom panels.
    const updateVh = () => {
      const h = tg.viewportHeight || browserViewportHeight();
      setVh(h);
    };
    updateVh();
    tg.onEvent('viewportChanged', updateVh);
    const cleanupViewport = bindBrowserViewport(updateVh);
    const settleTimer = setTimeout(updateVh, 250);

    setIsReady(true);

    return () => {
      clearTimeout(settleTimer);
      tg.offEvent?.('themeChanged', handleThemeChanged);
      tg.offEvent?.('viewportChanged', updateVh);
      cleanupViewport();
    };
  }, []);

  const initData = tg?.initData || '';
  const user = tg?.initDataUnsafe?.user || null;

  // ── Back Button ───────────────────────────────────────────────────────────
  const showBackButton = useCallback((onBack) => {
    if (!tg) return;
    tg.BackButton.show();
    tg.BackButton.onClick(onBack);
  }, []);

  const hideBackButton = useCallback(() => {
    if (!tg) return;
    tg.BackButton.hide();
  }, []);

  // ── Main Button ───────────────────────────────────────────────────────────
  const showMainButton = useCallback((text, onClick, options = {}) => {
    if (!tg) return;
    tg.MainButton.setText(text);
    tg.MainButton.onClick(onClick);
    if (options.color) tg.MainButton.setParams({ color: options.color });
    if (options.loading) tg.MainButton.showProgress(true);
    tg.MainButton.show();
  }, []);

  const hideMainButton = useCallback(() => {
    if (!tg) return;
    tg.MainButton.hide();
  }, []);

  const setMainButtonLoading = useCallback((loading) => {
    if (!tg) return;
    loading ? tg.MainButton.showProgress(true) : tg.MainButton.hideProgress();
  }, []);

  // ── Haptic Feedback ───────────────────────────────────────────────────────
  const haptic = {
    impact: (style = 'medium') => tg?.HapticFeedback?.impactOccurred(style),
    notification: (type = 'success') => tg?.HapticFeedback?.notificationOccurred(type),
    selection: () => tg?.HapticFeedback?.selectionChanged(),
  };

  // ── Popups ────────────────────────────────────────────────────────────────
  const showAlert = useCallback((message) => {
    return new Promise((resolve) => {
      if (tg?.showAlert) {
        tg.showAlert(message, resolve);
      } else {
        alert(message);
        resolve();
      }
    });
  }, []);

  const showConfirm = useCallback((message) => {
    return new Promise((resolve) => {
      if (tg?.showConfirm) {
        tg.showConfirm(message, resolve);
      } else {
        resolve(window.confirm(message));
      }
    });
  }, []);

  // ── Payment (Telegram Stars) ──────────────────────────────────────────────
  const openInvoice = useCallback((invoiceLink) => {
    return new Promise((resolve) => {
      if (tg?.openInvoice) {
        tg.openInvoice(invoiceLink, (status) => resolve(status));
      } else {
        resolve('cancelled');
      }
    });
  }, []);

  // ── Close App ─────────────────────────────────────────────────────────────
  const close = useCallback(() => {
    tg?.close();
  }, []);

  return {
    tg,
    isReady,
    initData,
    user,
    colorScheme,
    showBackButton,
    hideBackButton,
    showMainButton,
    hideMainButton,
    setMainButtonLoading,
    haptic,
    showAlert,
    showConfirm,
    openInvoice,
    close,
  };
}
