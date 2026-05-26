import { useEffect, useRef, useState, useMemo, createContext, useContext } from 'react';
import { AnimatePresence, motion } from '../../utils/safeMotion';
import { useGameStore } from '../../store/gameStore';
import { userApi } from '../../services/api';
import { useTelegram } from '../../hooks/useTelegram';
import InventoryItem from '../ui/InventoryItem';
import InventoryDetailModal from '../ui/InventoryDetailModal';
import { t } from '../../i18n';
import { ItemTypeIcon, GalaxyIcon, CoinIcon, CrystalIcon, UfoIcon, X, Check } from '../../icons';

// Shared toast context so InventoryDetailModal can trigger the fixed overlay toast
export const CollectionToastContext = createContext(null);

function estimateItemPrice(item) {
  return Number(item.sell_price || 0);
}

const TYPE_FILTERS = [
  { key: null,       labelKey: 'collection.allTypes'  },
  { key: 'debris',   labelKey: 'findType.scrap'       },
  { key: 'artifact', labelKey: 'findType.artifact'    },
  { key: 'creature', labelKey: 'findType.creature'    },
  { key: 'anomaly',  labelKey: 'findType.anomaly'     },
  { key: 'asteroid', labelKey: 'findType.asteroid'    },
  // U2
  { key: 'echo',     labelKey: 'findType.echo'        },
  { key: 'relic',    labelKey: 'findType.relic'       },
  { key: 'entity',   labelKey: 'findType.entity'      },
  { key: 'rift',     labelKey: 'findType.rift'        },
]

const SORT_OPTIONS = [
  { sortBy: 'date',   sortDir: 'desc', labelKey: 'collection.dateDesc' },
  { sortBy: 'date',   sortDir: 'asc',  labelKey: 'collection.dateAsc' },
  { sortBy: 'rarity', sortDir: 'desc', labelKey: 'collection.rarityDesc' },
  { sortBy: 'rarity', sortDir: 'asc',  labelKey: 'collection.rarityAsc' },
  { sortBy: 'price',  sortDir: 'desc', labelKey: 'collection.priceDesc' },
  { sortBy: 'price',  sortDir: 'asc',  labelKey: 'collection.priceAsc' },
];

const PAGE_SIZE = 30;

export default function CollectionPanel() {
  const { inventory, inventoryTotal, loadInventory, updateCredits, updateCrystals, user } = useGameStore();
  const { haptic, showConfirm } = useTelegram();
  const [activeFilter, setActiveFilter] = useState(null);
  const [sortIdx, setSortIdx]           = useState(0);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [offset, setOffset]             = useState(0);
  const [hasMore, setHasMore]           = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const reqIdRef = useRef(0);

  // ── Bulk sell mode ──
  const [sellMode, setSellMode]         = useState(false);
  const [selected, setSelected]         = useState(new Set());
  const [bulkSelling, setBulkSelling]   = useState(false);

  // ── Toast overlay (shared with InventoryDetailModal) ──
  const [toastMsg, setToastMsg]         = useState(null);
  const showToast = (msg, type='ok') => {
    setToastMsg({ msg, type });
    setTimeout(() => setToastMsg(null), 1500);
  };

  const currentSort   = SORT_OPTIONS[sortIdx];
  const currentType   = TYPE_FILTERS.find(f => f.key === activeFilter) || TYPE_FILTERS[0];
  const saleCurrency = user?.currentUniverse === 2 ? 'crystals' : 'credits';
  const SaleIcon = saleCurrency === 'crystals' ? CrystalIcon : CoinIcon;

  // Estimated total price for selected items
  const selectedTotal = useMemo(() => {
    if (!sellMode || selected.size === 0) return 0;
    return inventory
      .filter(i => selected.has(i.id))
      .reduce((sum, i) => sum + estimateItemPrice(i), 0);
  }, [sellMode, selected, inventory]);

  useEffect(() => { handleFreshLoad(); }, [activeFilter, sortIdx]);

  // Close menus when clicking outside
  useEffect(() => {
    const close = () => { setShowSortMenu(false); setShowTypeMenu(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const handleFreshLoad = async () => {
    const myId = ++reqIdRef.current;
    setLoading(true); setOffset(0);
    try {
      const data = await loadInventory({
        type: activeFilter, sortBy: currentSort.sortBy,
        sortDir: currentSort.sortDir, limit: PAGE_SIZE, offset: 0, _replace: true,
      });
      if (reqIdRef.current !== myId) return;
      setHasMore((data?.total ?? 0) > PAGE_SIZE);
    } catch {
      // ignore errors (including cancellations)
    } finally { if (reqIdRef.current === myId) setLoading(false); }
  };

  const handleLoadMore = async () => {
    const nextOffset = offset + PAGE_SIZE;
    setLoadingMore(true);
    const data = await loadInventory({
      type: activeFilter, sortBy: currentSort.sortBy,
      sortDir: currentSort.sortDir, limit: PAGE_SIZE, offset: nextOffset, _replace: false,
    });
    setOffset(nextOffset);
    setHasMore((data?.total ?? 0) > nextOffset + PAGE_SIZE);
    setLoadingMore(false);
  };

  // ── Bulk sell handlers ──
  const toggleSellMode = () => {
    setSellMode(v => !v);
    setSelected(new Set());
  };

  const toggleItem = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(inventory.filter(i => i.find_type !== 'nft_container').map(i => i.id)));
  };

  const handleBulkSell = async () => {
    if (selected.size === 0 || bulkSelling) return;
    const confirmed = await showConfirm(
      t('collection.bulkSellConfirm', { count: selected.size })
    );
    if (!confirmed) return;

    setBulkSelling(true);
    haptic.impact('medium');
    try {
      const result = await userApi.bulkSellItems([...selected]);
      haptic.notification('success');
      if (result.saleCurrency === 'crystals') {
        updateCrystals(result.crystalsRemaining);
        showToast(<span>{result.soldCount} {t('units.pcs')} · <CrystalIcon size={12} style={{verticalAlign:'middle',marginRight:2}} />+{result.totalPrice.toLocaleString()}</span>);
      } else {
        updateCredits(result.creditsRemaining);
        showToast(<span>{result.soldCount} {t('units.pcs')} · <CoinIcon size={12} style={{verticalAlign:'middle',marginRight:2}} />+{result.totalPrice.toLocaleString()}</span>);
      }
      setSellMode(false);
      setSelected(new Set());
      handleFreshLoad();
    } catch (err) {
      haptic.notification('error');
      showToast(err.message || t('common.error'), 'err');
    } finally {
      setBulkSelling(false);
    }
  };

  return (
    <CollectionToastContext.Provider value={showToast}>
    <div className="collection-panel">
      {/* ── Fixed toast overlay ── */}
      {toastMsg && (
        <div className="expedition-toast-overlay">
          <div className={`idm-toast${toastMsg.type === 'err' ? ' idm-toast--err' : ''}`}>
            {toastMsg.type === 'err'
              ? <X size={13} style={{verticalAlign:'middle',marginRight:4}} />
              : <Check size={13} style={{verticalAlign:'middle',marginRight:4}} />}
            {toastMsg.msg}
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="collection-header">
        <h2 className="collection-header__title">{t('collection.title')}</h2>

        {/* Type filter dropdown */}
        <div className="sort-wrap" style={{position:'relative'}} onClick={e => e.stopPropagation()}>
          <button
            className={`sort-btn ${activeFilter ? 'sort-btn--active' : ''}`}
            onClick={() => { setShowTypeMenu(v => !v); setShowSortMenu(false); }}
          >
            <span className="sort-btn__label">
              <ItemTypeIcon type={currentType.key} size={14} style={{verticalAlign:'middle',marginRight:4}} />
              {t(currentType.labelKey)}
            </span>
            <span className="sort-btn__caret" aria-hidden="true">▾</span>
          </button>
          <AnimatePresence>
            {showTypeMenu && (
              <motion.div className="sort-dropdown"
                initial={{ opacity:0, y:-6 }} animate={{ opacity:1, y:0 }}
                exit={{ opacity:0, y:-6 }} transition={{ duration:0.15 }}
              >
                {TYPE_FILTERS.map(f => (
                  <button key={f.key||'all'}
                    className={`sort-option ${activeFilter === f.key ? 'active' : ''}`}
                    onClick={() => { setActiveFilter(f.key); setShowTypeMenu(false); }}
                  >
                    <ItemTypeIcon type={f.key} size={14} style={{verticalAlign:'middle',marginRight:5}} />{t(f.labelKey)}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sort dropdown */}
        <div className="sort-wrap" style={{position:'relative'}} onClick={e => e.stopPropagation()}>
          <button className="sort-btn" onClick={() => { setShowSortMenu(v => !v); setShowTypeMenu(false); }}>
            <span className="sort-btn__label">{t(currentSort.labelKey)}</span>
            <span className="sort-btn__caret" aria-hidden="true">▾</span>
          </button>
          <AnimatePresence>
            {showSortMenu && (
              <motion.div className="sort-dropdown"
                initial={{ opacity:0, y:-6 }} animate={{ opacity:1, y:0 }}
                exit={{ opacity:0, y:-6 }} transition={{ duration:0.15 }}
              >
                {SORT_OPTIONS.map((opt,i) => (
                  <button key={i}
                    className={`sort-option ${i === sortIdx ? 'active' : ''}`}
                    onClick={() => { setSortIdx(i); setShowSortMenu(false); }}
                  >{t(opt.labelKey)}</button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {inventory.length > 0 && (
          <button
            className={`bulk-sell-toggle ${sellMode ? 'bulk-sell-toggle--active' : ''}`}
            onClick={toggleSellMode}
          >
            {sellMode ? '✕' : <SaleIcon size={16} />}
          </button>
        )}
      </div>

      {/* ── Sell mode bar ── */}
      {sellMode && (
        <div className="bulk-sell-bar">
          <button className="btn btn-secondary btn-sm" onClick={selectAll}>
            {t('common.selectAll')}
          </button>
          <span className="bulk-count">
            {t('common.selected')}
            <strong className="bulk-count-num">{selected.size}</strong>
          </span>
        </div>
      )}

      {/* ── Grid ── */}
      {loading ? (
        <div className="center-spinner"><span className="spinner spinner-lg"/></div>
      ) : inventory.length === 0 ? (
        <div className="empty-state">
          <p><UfoIcon size={48} /></p>
          <p>{activeFilter ? t('collection.noItemsType') : t('collection.noItems')}</p>
          {!activeFilter && <p className="hint-text">{t('collection.goExplore')}</p>}
        </div>
      ) : (
        <>
          <motion.div className="inventory-grid">
            {inventory.map((item,i) => (
              <motion.div key={item.id}
                initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}
                transition={{ delay: Math.min(i,10)*0.03 }}
                onClick={() => sellMode ? (item.find_type !== 'nft_container' && toggleItem(item.id)) : setSelectedItem(item)}
                style={{ cursor:'pointer', position:'relative' }}
              >
                {sellMode && (
                  <div className={`bulk-check ${selected.has(item.id) ? 'bulk-check--on' : ''}`}>
                    {selected.has(item.id) ? '✓' : ''}
                  </div>
                )}
                <InventoryItem item={item}/>
              </motion.div>
            ))}
          </motion.div>
          {hasMore && (
            <div className="load-more-wrap">
              <button className="btn btn-secondary load-more-btn" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? <span className="spinner"/> : t('common.loadMore')}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Sticky bulk sell bottom bar ── */}
      {sellMode && (
        <div className="bulk-sell-footer">
          <button
            className="btn btn-sell bulk-sell-btn"
            onClick={handleBulkSell}
            disabled={bulkSelling || selected.size === 0}
          >
            {bulkSelling
              ? <span className="spinner"/>
              : <><SaleIcon size={14} style={{verticalAlign:'middle',marginRight:4}} />{t('collection.bulkSellBtn')} {selected.size > 0 && <span className="bulk-sell-price">{saleCurrency === 'crystals' ? t('collection.approxCrystals', { total: selectedTotal.toLocaleString() }) : t('collection.approxCoins', { total: selectedTotal.toLocaleString() })}</span>}</>
            }
          </button>
        </div>
      )}

      <AnimatePresence>
        {selectedItem && !sellMode && (
          <InventoryDetailModal
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onSold={() => { setSelectedItem(null); handleFreshLoad(); }}
          />
        )}
      </AnimatePresence>
    </div>
    </CollectionToastContext.Provider>
  );
}
