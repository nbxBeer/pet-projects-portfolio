import { useState, memo } from 'react';
import { motion, AnimatePresence } from '../../utils/safeMotion';
import { useGameStore } from '../../store/gameStore';
import { isRu } from '../../i18n';

export default memo(function NewsBanner() {
  const news = useGameStore((s) => s.activeNews);
  const [showInfo, setShowInfo] = useState(false);

  if (!news) return null;

  const title = isRu() ? news.titleRu : news.titleEn;
  const description = isRu() ? news.descriptionRu : news.descriptionEn;

  return (
    <div className="event-banner-wrap">
      <button
        className="event-btn"
        onClick={() => setShowInfo((v) => !v)}
        title={title}
      >
        <span className="event-btn-icon">{news.icon || '📰'}</span>
      </button>

      <AnimatePresence>
        {showInfo && (
          <motion.div
            className="event-popup event-popup--right"
            initial={{ opacity: 0, scale: 0.85, x: -8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.85, x: -8 }}
            transition={{ duration: 0.15 }}
          >
            <div className="event-popup-title">{news.icon || '📰'} {title}</div>
            {description && (
              <div className="event-popup-desc">{description}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
