// StarLoot icon system — central export
// Use: import { DebrisIcon, CoinIcon, Package, Zap } from '../../icons';

// ─── Lucide UI icons ──────────────────────────────────────────────────────────
export {
  Package,        // 📦 cargo, storage, cargo_full state
  FlaskConical,   // 🧪 capsule module, no_capsule state
  Shield,         // 🛡️ stealth module
  ScrollText,     // 📜 insurance / story tab
  Map,            // 🗺️ cartographer
  Telescope,      // 🔭 quantum locator
  Zap,            // ⚡ turbo engine
  Satellite,      // 🛰️ remote scanner
  Rocket,         // 🚀 ship upgrades tab / expedition nav
  ClipboardList,  // 📋 quests button
  Sparkles,       // ✨ active buffs
  Eye,            // 👁 entity type
  Gift,           // 🎁 nft_container, bonuses tab
  Cog,            // ⚙️ drill yield upgrade
  ArrowUp,        // ⬆️ upgrade arrow
  Skull,          // 💀 pirate / skull
  Hourglass,      // ⏳ pending tournament
  X,              // ❌ error state
  Check,          // ✅ success state
  Ruler,          // 📐 volume hint
  Dna,            // 🧬 XP indicator
  Star,           // ⭐ Telegram Stars
  Atom,           // ⚛️ long expedition / atom
  Pickaxe,        // ⛏️ drills nav tab
  ShoppingCart,   // 🛒 shop/upgrades nav tab
  Trash2,         // 🗑️ delete action
  RefreshCw,      // 🔄 reroll / refresh
  Calendar,       // 📅 timer / date chip
  Trophy,         // 🏆 achievements / leaderboard
  BarChart2,      // 📊 stats
  Palette,        // 🎨 customization
  Users,          // 👥 referrals / social
  Link2,          // 🔗 invite link
  TrendingUp,     // 📈 income / progression
  Award,          // 🏅 milestones
  Lock,           // 🔒 locked/restricted state
  AlertTriangle,  // ⚠️ warnings / penalties
} from 'lucide-react';

// ─── Custom game icons ────────────────────────────────────────────────────────
export {
  DebrisIcon,           // 🔩 debris type / metal fossils
  ArtifactIcon,         // 💎 artifact type / crystal fossils
  CreatureIcon,         // 🐾 creature type / organic fossils
  AnomalyIcon,          // 🌀 anomaly type / gravity fossils
  AsteroidIcon,         // ☄️ asteroid type / energetic fossils
  ScannerIcon,          // 🎯 scanner module (radar design)
  SignalAmplifierIcon,  // 📡 signal amplifier (radio waves)
  DeepDrillIcon,        // ⛏️ deep core drill
  EchoIcon,             // 〰️ echo type (U2) / nebula fossils
  RelicStatueIcon,      // 🗿 relic type (U2)
  RiftIcon,             // 🌌 rift type (U2) / chrono fossils
  GalaxyIcon,           // 🌌 all-types filter / singularity fossils
  CoinIcon,             // 🪙 credits currency
  CrystalIcon,          // 💎 crystal currency (U2)
  XpIcon,               // 🧬 XP (alternative to Dna)
  RockIcon,             // 🪨 fossil / drill upgrade
  UfoIcon,              // 🛸 empty state
  MedalIcon,            // 🥇🥈🥉 tournament rank
  RarityDot,            // ⚪🔵🟣... rarity indicator dot
  ItemTypeIcon,         // Convenience: renders correct icon by find_type string
  FactionIcon,          // Faction-specific icons (auto-maps faction id → SVG icon)
  BioengineersFactionIcon,
  TechInstituteFactionIcon,
  NavigatorsOrderFactionIcon,
  BlackMarketFactionIcon,
  ChroniclersFactionIcon,
  VoidSeekersFactionIcon,
  ResonatorsFactionIcon,
  HaulersFactionIcon,
  ExhibitionIcon,       // 🏛️ museum/gallery building — exhibition button & pass icon
} from './GameIcons';
