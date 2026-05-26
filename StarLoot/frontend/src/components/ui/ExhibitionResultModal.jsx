import Modal from './Modal';
import { CoinIcon } from '../../icons';
import { t } from '../../i18n';

export default function ExhibitionResultModal({ result, onClose }) {
  if (!result) return null;
  const stolen = result.outcome === 'stolen';

  return (
    <Modal open onClose={onClose} title={t('exhibition.report')} className="exhibition-result-modal">
      <div className="exh-result-body">
        {stolen ? (
          <>
            <div className="exh-result-icon exh-result-icon--stolen">💔</div>
            <p className="exh-result-title">{t('exhibition.stolen')}</p>
            <p className="exh-result-desc">{t('exhibition.attackDesc')}</p>
          </>
        ) : (
          <>
            <div className="exh-result-icon">🏛️</div>
            <p className="exh-result-title">{t('exhibition.returned')}</p>
            <div className="exh-sympathy-bar">
              <div className="exh-sympathy-label">{t('exhibition.viewerSympathy')}</div>
              <div className="exh-sympathy-track">
                <div className="exh-sympathy-fill" style={{ width: `${result.sympathyPercent}%` }} />
              </div>
              <div className="exh-sympathy-value">{result.sympathyPercent}%</div>
            </div>
            <div className="exh-result-reward">
              <CoinIcon size={18} style={{ verticalAlign: 'middle', marginRight: 5 }} />
              <span>+{(result.creditsEarned || 0).toLocaleString()}</span>
            </div>
            <p className="exh-result-desc">{t('exhibition.rewardDesc')}</p>
          </>
        )}
      </div>
      <div className="idm-actions">
        <button className="btn btn-collect" onClick={onClose}>
          {stolen ? t('common.close') : t('exhibition.collect')}
        </button>
      </div>
    </Modal>
  );
}
