import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';

const POLL_INTERVAL = 60_000; // 60 seconds

export default function UpdateBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const initialVersion = useRef(null);

  useEffect(() => {
    let timer;

    async function fetchVersion() {
      try {
        const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (initialVersion.current === null) {
          initialVersion.current = data.v;
        } else if (data.v !== initialVersion.current) {
          setShowBanner(true);
          clearInterval(timer);
          window.setTimeout(() => window.location.reload(), 800);
        }
      } catch {
        // network error — ignore, keep polling
      }
    }

    fetchVersion();
    timer = setInterval(fetchVersion, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  if (!showBanner) return null;

  return (
    <div className="update-banner update-banner--info">
      <span className="update-banner-icon">🔄</span>
      <div className="update-banner-text">
        <strong>{t('update.title')}</strong>
        <span>{t('update.desc')}</span>
      </div>
    </div>
  );
}
