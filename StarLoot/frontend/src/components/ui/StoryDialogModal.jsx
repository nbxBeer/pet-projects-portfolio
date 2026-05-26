import { useState, useCallback } from 'react';
import { t, isRu } from '../../i18n';

const FACTION_COLORS = {
  navigators_order: '#22d3ee',
  bioengineers:     '#22c55e',
  tech_institute:   '#4f8ef7',
  black_market:     '#c084fc',
};

function NpcSilhouette({ factionId }) {
  const color = FACTION_COLORS[factionId] || '#22d3ee';
  return (
    <div className="sdm-portrait" style={{ '--sdm-color': color }}>
      <svg viewBox="0 0 60 70" className="sdm-figure" aria-hidden="true">
        <ellipse cx="30" cy="20" rx="11" ry="12" fill={color} opacity="0.75" />
        <path d="M10 70 C10 46 50 46 50 70" fill={color} opacity="0.75" />
      </svg>
      <div className="sdm-portrait-glow" />
    </div>
  );
}

export default function StoryDialogModal({ dialog, onDismiss }) {
  const [nodeId, setNodeId] = useState(dialog.nodes[0].id);

  const currentNode = dialog.nodes.find(n => n.id === nodeId) || dialog.nodes[0];
  const isTerminal = currentNode.choices.length === 0;

  const handleChoice = useCallback((choice) => {
    if (choice.next) {
      setNodeId(choice.next);
    } else {
      onDismiss(choice.markSeen === true);
    }
  }, [onDismiss]);

  const handleTerminalClose = useCallback(() => {
    onDismiss(true);
  }, [onDismiss]);

  const npc = dialog.npc;
  const factionId = dialog.factionId;
  const color = FACTION_COLORS[factionId] || '#22d3ee';

  return (
    <div className="sdm-overlay" onClick={() => onDismiss(false)}>
      <div className="sdm-panel" onClick={e => e.stopPropagation()}>
        <div className="sdm-header" style={{ borderBottomColor: color + '40' }}>
          <NpcSilhouette factionId={factionId} />
          <div className="sdm-npc-info">
            <span className="sdm-npc-name" style={{ color }}>{isRu() ? npc.nameRu : npc.nameEn}</span>
            <span className="sdm-npc-title">{isRu() ? npc.titleRu : npc.titleEn}</span>
          </div>
          <button className="sdm-close" onClick={() => onDismiss(false)}>✕</button>
        </div>

        <div className="sdm-body">
          <p className="sdm-text">{isRu() ? currentNode.textRu : currentNode.textEn}</p>
        </div>

        <div className="sdm-choices">
          {isTerminal ? (
            <button
              className="sdm-choice sdm-choice-accept"
              style={{ borderColor: color, color }}
              onClick={handleTerminalClose}
            >
              {t('common.close')}
            </button>
          ) : (
            currentNode.choices.map(choice => (
              <button
                key={choice.id}
                className={`sdm-choice ${choice.markSeen !== false ? 'sdm-choice-accept' : 'sdm-choice-later'}`}
                style={choice.markSeen !== false ? { borderColor: color, color } : {}}
                onClick={() => handleChoice(choice)}
              >
                {isRu() ? choice.labelRu : choice.labelEn}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
