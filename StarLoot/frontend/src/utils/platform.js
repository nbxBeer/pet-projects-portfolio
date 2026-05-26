import { useEffect, useState } from 'react';

function getTelegramPlatformFromUrl() {
  try {
    const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    const searchParams = new URLSearchParams(String(window.location.search || ''));
    return String(hashParams.get('tgWebAppPlatform') || searchParams.get('tgWebAppPlatform') || '').toLowerCase();
  } catch {
    return '';
  }
}

function isIosLike(platform, userAgent) {
  const nav = window.navigator || {};
  return Boolean(
    platform.includes('ios') ||
      /iPhone|iPad|iPod/i.test(userAgent) ||
      (nav.platform === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1)
  );
}

function isCoarseTouchOnly() {
  try {
    return Boolean(window.matchMedia?.('(pointer: coarse) and (hover: none)')?.matches);
  } catch {
    return false;
  }
}

export function isAndroidWebView() {
  if (typeof window === 'undefined') return false;

  const nav = window.navigator || {};
  const telegramPlatform = String(window.Telegram?.WebApp?.platform || getTelegramPlatformFromUrl()).toLowerCase();
  const userAgent = String(nav.userAgent || '');
  const iosLike = isIosLike(telegramPlatform, userAgent);

  return Boolean(
    window.__STARLOOT_ANDROID_WEBVIEW__ ||
      document.documentElement.classList.contains('tg-android') ||
      document.body?.classList?.contains('tg-android') ||
      getTelegramPlatformFromUrl().includes('android') ||
      telegramPlatform.includes('android') ||
      /Android/i.test(userAgent) ||
      (isCoarseTouchOnly() && !iosLike)
  );
}

export function useAndroidWebView() {
  const [androidWebView, setAndroidWebView] = useState(isAndroidWebView);

  useEffect(() => {
    const update = () => setAndroidWebView(isAndroidWebView());
    const telegram = window.Telegram?.WebApp;

    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener?.('resize', update);
    telegram?.onEvent?.('viewportChanged', update);

    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener?.('resize', update);
      telegram?.offEvent?.('viewportChanged', update);
    };
  }, []);

  return androidWebView;
}
