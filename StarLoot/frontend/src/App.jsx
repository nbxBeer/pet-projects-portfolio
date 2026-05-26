import { useEffect, useLayoutEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { useTelegram } from './hooks/useTelegram';
import { useGameStore } from './store/gameStore';
import ExpeditionPanel from './components/panels/ExpeditionPanel';
import CollectionPanel from './components/panels/CollectionPanel';
import UpgradesPanel from './components/panels/UpgradesPanel';
import DrillsPanel from './components/panels/DrillsPanel';
import BottomNav from './components/ui/BottomNav';
import UserHeader from './components/ui/UserHeader';
import LoadingScreen from './components/ui/LoadingScreen';
import ErrorToast from './components/ui/ErrorToast';
import ActiveBuffsBar from './components/ui/ActiveBuffsBar';
import UpdateBanner from './components/ui/UpdateBanner';
import { ReferralEntryModal } from './components/ui/ReferralView';
import { isAndroidWebView } from './utils/platform';
import { getLang, onLanguageChange } from './i18n';
import './assets/styles/global.css';

function shouldUsePerfLite() {
  const nav = window.navigator;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const saveData = Boolean(nav.connection?.saveData);
  const lowCpu = Number(nav.hardwareConcurrency || 8) <= 2;
  const lowMem = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 3;
  return Boolean(reduceMotion || saveData || lowCpu || lowMem);
}

function shouldUseAndroidWebViewFixes() {
  return isAndroidWebView();
}

export default function App() {
  const { isReady } = useTelegram();
  const activeTab = useGameStore((s) => s.activeTab);
  const loadingProfile = useGameStore((s) => s.loading.profile);
  const error = useGameStore((s) => s.error);
  const loadProfile = useGameStore((s) => s.loadProfile);
  const loadActiveEvent = useGameStore((s) => s.loadActiveEvent);
  const loadActiveTournament = useGameStore((s) => s.loadActiveTournament);
  const loadActiveNews = useGameStore((s) => s.loadActiveNews);
  const user = useGameStore((s) => s.user);
  const [showReferralEntry, setShowReferralEntry] = useState(false);
  const [perfLite, setPerfLite] = useState(false);
  const [androidWebView, setAndroidWebView] = useState(shouldUseAndroidWebViewFixes);
  const [lang, setLang] = useState(getLang());

  useEffect(() => {
    return onLanguageChange((nextLang) => setLang(nextLang));
  }, []);

  useEffect(() => {
    if (isReady) {
      loadProfile();
    }
  }, [isReady]);

  // Show referral entry for new users who haven't set a referrer
  useEffect(() => {
    if (!user) return;
    if (!user.tosAccepted) {
      setShowReferralEntry(true);
      return;
    }
    const alreadyDone = localStorage.getItem(`ref_prompt_done_${user.id}`);
    const hasReferrer = user.referredBy != null;
    if (alreadyDone || hasReferrer) return;

    // Extract ref code from deep link or pending referrer saved by bot
    const params = new URLSearchParams(window.location.search);
    const refFromUrl = params.get('ref');
    const chatFromUrl = params.get('chat');
    const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    const refFromTg = startParam?.startsWith('ref_') ? startParam.slice(4) : null;
    const chatFromTg = startParam?.startsWith('chat_') ? startParam.slice(5) : null;
    const refFromDb = user.pendingReferrerId || null;
    const refCode = refFromUrl || refFromTg || refFromDb;

    // Chat deep links are tracked separately and should not open the referral modal.
    if (chatFromUrl || chatFromTg) return;

    // Block self-referral deep links
    if (refCode && String(refCode) === String(user.id)) return;

    // Show prompt only for new users OR when a valid deep link ref code is present
    const isNewUser = user.createdAt && (Date.now() - new Date(user.createdAt).getTime() < 300000); // <5 min
    if (isNewUser || refCode) {
      setShowReferralEntry(true);
    }
  }, [user]);

  // Auto-enable lightweight visual mode on constrained devices.
  useLayoutEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const connection = window.navigator.connection;
    const update = () => {
      const android = shouldUseAndroidWebViewFixes();
      setPerfLite(shouldUsePerfLite());
      setAndroidWebView(android);
      document.documentElement.classList.toggle('tg-android', android);
      document.body.classList.toggle('tg-android', android);
    };

    update();
    media?.addEventListener?.('change', update);
    connection?.addEventListener?.('change', update);

    return () => {
      media?.removeEventListener?.('change', update);
      connection?.removeEventListener?.('change', update);
      document.documentElement.classList.remove('tg-android');
      document.body.classList.remove('tg-android');
    };
  }, []);
  // Poll active event, tournament, and news every 60s (single centralized poll)
  useEffect(() => {
    if (!isReady) return;
    const timer = setInterval(() => {
      loadActiveEvent();
      loadActiveTournament();
      loadActiveNews();
    }, 60_000);
    return () => clearInterval(timer);
  }, [isReady]);

  if (!isReady || (!user && loadingProfile)) {
    return <LoadingScreen />;
  }

  return (
    <MotionConfig reducedMotion={androidWebView ? 'always' : 'user'}>
      <div key={lang} className={`app app-tab-${activeTab}${perfLite ? ' perf-lite' : ''}${androidWebView ? ' tg-android' : ''}`}>
        <UpdateBanner />
        <UserHeader />
        <ActiveBuffsBar />
        <main className="app-content">
          {activeTab === 'expedition' && <ExpeditionPanel />}
          {activeTab === 'collection' && <CollectionPanel />}
          {activeTab === 'drills' && <DrillsPanel />}
          {activeTab === 'upgrades' && <UpgradesPanel />}
        </main>
        <BottomNav />
        {error && <ErrorToast />}
        {showReferralEntry && <ReferralEntryModal onDone={() => setShowReferralEntry(false)} />}
      </div>
    </MotionConfig>
  );
}
