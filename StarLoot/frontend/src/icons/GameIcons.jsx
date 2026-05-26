// StarLoot — Custom game SVG icons
// All icons: 24×24 viewBox, stroke-based, consistent with lucide-react style

// ─── Base wrapper ─────────────────────────────────────────────────────────────
function Svg({ size = 24, color = 'currentColor', className = '', style, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// ─── Item type icons ──────────────────────────────────────────────────────────

// 🔩 Debris — angular metal shards / broken spacecraft panel
export function DebrisIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Main angular shard – irregular pentagon */}
      <polygon points="5,4 17,3 21,9 17,19 7,20 3,13" />
      {/* Fracture crack across the piece */}
      <path d="M12 4 L11 9 L15 12 L13 18" strokeWidth="1.2" />
      {/* Rivet / bolt holes */}
      <circle cx="7" cy="8" r="1" strokeWidth="1.2" />
      <circle cx="17" cy="6" r="1" strokeWidth="1.2" />
      {/* Detached chip breaking off lower-right */}
      <polygon points="18,19 22,16 23,21 19,22" strokeWidth="1.2" />
    </Svg>
  );
}

// 💎 Artifact — gem crystal
export function ArtifactIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <path d="M6 3h12l4 6-10 13L2 9z" />
      <line x1="2" y1="9" x2="22" y2="9" />
      <line x1="6" y1="3" x2="12" y2="9" />
      <line x1="18" y1="3" x2="12" y2="9" />
    </Svg>
  );
}

// 🐾 Creature — 4-toed paw print
export function CreatureIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Four toes */}
      <ellipse cx="6"  cy="10" rx="1.8" ry="2.3" />
      <ellipse cx="10" cy="7"  rx="1.8" ry="2.3" />
      <ellipse cx="14" cy="7"  rx="1.8" ry="2.3" />
      <ellipse cx="18" cy="10" rx="1.8" ry="2.3" />
      {/* Main pad */}
      <path d="M7 17 Q12 13 17 17 L16 21 Q12 23 8 21 Z" />
    </Svg>
  );
}

// 🌀 Anomaly — vortex
export function AnomalyIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10a5 5 0 0 1 5 5 7.1 7.1 0 0 1-12.3 2.4" />
      <path d="M17.8 7A10 10 0 0 1 5.3 19.3" />
    </Svg>
  );
}

// ☄️ Asteroid — lumpy rocky body with craters, comet tail upper-left
export function AsteroidIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Irregular rocky body – bumpy, asymmetric */}
      <path d="M15 3 Q20 3 22 7 Q24 12 22 16 Q20 20 16 21 Q11 22 7 19 Q3 16 2 12 Q1 7 4 5 Q8 2 15 3Z" />
      {/* Surface craters */}
      <circle cx="12" cy="12" r="2.2" strokeWidth="1.2" />
      <circle cx="17" cy="16" r="1.3" strokeWidth="1.2" />
      {/* Comet tail – upper-left (asteroid moving toward lower-right) */}
      <line x1="3" y1="9" x2="1" y2="5" />
      <line x1="5" y1="6" x2="3" y2="3" />
      <line x1="7" y1="4" x2="6" y2="1" />
    </Svg>
  );
}

// 🎯 Scanner — radar targeting circles with sweep arm
export function ScannerIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
      <line x1="12" y1="12" x2="19.5" y2="4.5" />
      <line x1="12" y1="3" x2="12" y2="4" />
      <line x1="21" y1="12" x2="20" y2="12" />
    </Svg>
  );
}

// 〰️ Echo — three wavy lines
export function EchoIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <path d="M3 8 Q6 5 9 8 Q12 11 15 8 Q18 5 21 8" />
      <path d="M3 12 Q6 9 9 12 Q12 15 15 12 Q18 9 21 12" />
      <path d="M3 16 Q6 13 9 16 Q12 19 15 16 Q18 13 21 16" />
    </Svg>
  );
}

// 🗿 Relic — stone monolith / obelisk
export function RelicStatueIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <path d="M9 21V4a3 3 0 0 1 6 0v17" />
      <line x1="7" y1="21" x2="17" y2="21" />
      <circle cx="12" cy="9" r="1.5" />
      <line x1="10" y1="13" x2="14" y2="13" />
    </Svg>
  );
}

// 🌌 Rift — black hole / void portal
export function RiftIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="7" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <line x1="2" y1="12" x2="7" y2="12" />
      <line x1="17" y1="12" x2="22" y2="12" />
      <line x1="5.6" y1="5.6" x2="8.9" y2="8.9" />
      <line x1="15.1" y1="15.1" x2="18.4" y2="18.4" />
      <line x1="18.4" y1="5.6" x2="15.1" y2="8.9" />
      <line x1="8.9" y1="15.1" x2="5.6" y2="18.4" />
    </Svg>
  );
}

// 🌌 Galaxy — spiral galaxy (used for "All types" filter)
export function GalaxyIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10a7 4 0 1 1 .1 0" />
      <path d="M12 7a10 6 30 1 0-.1 0" />
    </Svg>
  );
}

// ─── Currency icons ───────────────────────────────────────────────────────────

// 🪙 Coin — credits
export function CoinIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v1.5m0 5V16m0-6.5c-1.5 0-2.5.7-2.5 1.7s1 1.5 2.5 1.8c1.5.3 2.5 1 2.5 2s-1 1.7-2.5 1.7" />
    </Svg>
  );
}

// 💎 Crystal — crystal currency (U2)
export function CrystalIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <path d="M12 2L4 8v8l8 6 8-6V8z" />
      <line x1="4" y1="8" x2="12" y2="12" />
      <line x1="20" y1="8" x2="12" y2="12" />
      <line x1="12" y1="12" x2="12" y2="22" />
    </Svg>
  );
}

// 🧬 XP / DNA — experience points
export function XpIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <path d="M2 12 Q6 4 12 12 Q18 20 22 12" />
      <path d="M2 12 Q6 20 12 12 Q18 4 22 12" />
    </Svg>
  );
}

// ─── Drill / mining icons ─────────────────────────────────────────────────────

// 🪨 Rock — fossil/mining
export function RockIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <path d="M5 17 Q3 11 6 7 Q9 3 14 3 Q19 3 21 7 Q23 11 21 15 Q19 19 14 21 Q8 22 5 17z" />
      <path d="M8 8 Q11 6 14 8" />
      <path d="M7 13 Q10 12 12 14" />
    </Svg>
  );
}

// ⛏️ Deep Core Drill — heavy drill going deep with spiral bit
export function DeepDrillIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <rect x="9" y="2" width="6" height="7" rx="1.5" />
      <path d="M9 9 Q7 11.5 9 14 Q11 16.5 9 19" />
      <path d="M15 9 Q17 11.5 15 14 Q13 16.5 15 19" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <path d="M9 19 L12 22 L15 19" />
      <line x1="3" y1="14" x2="6.5" y2="14" />
      <line x1="17.5" y1="14" x2="21" y2="14" />
    </Svg>
  );
}

// 📡 Signal Amplifier — radio waves broadcasting upward
export function SignalAmplifierIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <circle cx="12" cy="17" r="2" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <path d="M8.5 14 Q8.5 9 12 7.5 Q15.5 9 15.5 14" />
      <path d="M5 16.5 Q5 6 12 3 Q19 6 19 16.5" />
    </Svg>
  );
}

// ─── UI / State icons ─────────────────────────────────────────────────────────

// 🛸 UFO — empty state / pirate ship
export function UfoIcon({ size, color, className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      <ellipse cx="12" cy="15" rx="10" ry="3.5" />
      <path d="M7 15 Q8 8 12 6 Q16 8 17 15" />
      <circle cx="12" cy="10.5" r="2" />
      <ellipse cx="7" cy="15.5" rx="1.2" ry="0.8" />
      <ellipse cx="12" cy="17" rx="1.2" ry="0.8" />
      <ellipse cx="17" cy="15.5" rx="1.2" ry="0.8" />
    </Svg>
  );
}

// ─── Achievement icons ────────────────────────────────────────────────────────

// 🥇🥈🥉 Medal — tournament rank
export function MedalIcon({ rank = 1, size = 20, className, style }) {
  const colors = { 1: '#ffd700', 2: '#c0c0c0', 3: '#cd7f32' };
  const fill = colors[rank] || '#9e9e9e';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="6" fill={fill} />
      <path d="M9 14L7 22l5-2 5 2-2-8" fill={fill} />
      <text
        x="12"
        y="11"
        textAnchor="middle"
        fontSize="8"
        fontWeight="bold"
        fill="#1a1a2e"
        style={{ fontFamily: 'sans-serif' }}
      >
        {rank}
      </text>
    </svg>
  );
}

// ─── Rarity dot ───────────────────────────────────────────────────────────────

// Replaces ⚪🔵🟣🟡🔴🩵🟤🟠💜💫 — just a CSS-colored circle, no emoji
export function RarityDot({ color, size = 10, className, style }) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        boxShadow: `0 0 5px ${color}`,
        ...style,
      }}
    />
  );
}

// ─── Faction icons ────────────────────────────────────────────────────────────

// 🧬 Bioengineers — organic double-helix with leaf nodes
export function BioengineersFactionIcon({ size = 24, color = 'currentColor', className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Double helix strands */}
      <path d="M8 3 Q12 7 16 11 Q12 15 8 19" strokeWidth="2" />
      <path d="M16 3 Q12 7 8 11 Q12 15 16 19" strokeWidth="2" />
      {/* Cross-bridges */}
      <line x1="8.5" y1="6.5" x2="15.5" y2="6.5" strokeWidth="1.5" />
      <line x1="10" y1="11" x2="14" y2="11" strokeWidth="1.5" />
      <line x1="8.5" y1="15.5" x2="15.5" y2="15.5" strokeWidth="1.5" />
      {/* Organic nodes */}
      <circle cx="8" cy="3" r="1.5" fill={color} stroke="none" />
      <circle cx="16" cy="3" r="1.5" fill={color} stroke="none" />
      <circle cx="8" cy="19" r="1.5" fill={color} stroke="none" />
      <circle cx="16" cy="19" r="1.5" fill={color} stroke="none" />
      {/* Growth tendrils */}
      <path d="M4 11 Q6 10 8 11" strokeWidth="1.25" />
      <path d="M20 11 Q18 10 16 11" strokeWidth="1.25" />
    </Svg>
  );
}

// ⚙️ Tech Institute — hexagonal processor chip with circuit traces
// Museum/gallery building — used for exhibition_pass and exhibition button
export function ExhibitionIcon({ size = 24, color = 'currentColor', className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Pediment (roof triangle) */}
      <polyline points="2,9 12,3 22,9" strokeWidth="1.75" />
      {/* Entablature (top beam) */}
      <line x1="2" y1="9" x2="22" y2="9" strokeWidth="1.75" />
      {/* Base platform */}
      <line x1="1" y1="21" x2="23" y2="21" strokeWidth="1.75" />
      <line x1="2" y1="19" x2="22" y2="19" strokeWidth="1.5" />
      {/* Columns */}
      <line x1="5"  y1="9" x2="5"  y2="19" strokeWidth="1.5" />
      <line x1="9"  y1="9" x2="9"  y2="19" strokeWidth="1.5" />
      <line x1="12" y1="9" x2="12" y2="19" strokeWidth="1.5" />
      <line x1="15" y1="9" x2="15" y2="19" strokeWidth="1.5" />
      <line x1="19" y1="9" x2="19" y2="19" strokeWidth="1.5" />
    </Svg>
  );
}

export function TechInstituteFactionIcon({ size = 24, color = 'currentColor', className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Chip body */}
      <rect x="7" y="7" width="10" height="10" rx="2" strokeWidth="1.75" />
      {/* Inner core */}
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" strokeWidth="1.25" />
      {/* Circuit pins — top */}
      <line x1="9" y1="7" x2="9" y2="3.5" strokeWidth="1.5" />
      <line x1="12" y1="7" x2="12" y2="3.5" strokeWidth="1.5" />
      <line x1="15" y1="7" x2="15" y2="3.5" strokeWidth="1.5" />
      {/* Circuit pins — bottom */}
      <line x1="9" y1="17" x2="9" y2="20.5" strokeWidth="1.5" />
      <line x1="12" y1="17" x2="12" y2="20.5" strokeWidth="1.5" />
      <line x1="15" y1="17" x2="15" y2="20.5" strokeWidth="1.5" />
      {/* Circuit pins — left */}
      <line x1="7" y1="10" x2="3.5" y2="10" strokeWidth="1.5" />
      <line x1="7" y1="14" x2="3.5" y2="14" strokeWidth="1.5" />
      {/* Circuit pins — right */}
      <line x1="17" y1="10" x2="20.5" y2="10" strokeWidth="1.5" />
      <line x1="17" y1="14" x2="20.5" y2="14" strokeWidth="1.5" />
    </Svg>
  );
}

// 🧭 Navigators Order — compass rose with orbital ring
export function NavigatorsOrderFactionIcon({ size = 24, color = 'currentColor', className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Outer ring */}
      <circle cx="12" cy="12" r="9" strokeWidth="1.5" />
      {/* Compass cardinal spikes */}
      <polygon points="12,3 10.5,10 12,8.5 13.5,10" fill={color} stroke="none" />
      <polygon points="12,21 10.5,14 12,15.5 13.5,14" fill={color} stroke="none" />
      <polygon points="3,12 10,10.5 8.5,12 10,13.5" fill={color} stroke="none" />
      <polygon points="21,12 14,10.5 15.5,12 14,13.5" fill={color} stroke="none" />
      {/* Center pivot */}
      <circle cx="12" cy="12" r="2" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="0.75" fill={color} stroke="none" />
      {/* Diagonal tick marks */}
      <line x1="5.6" y1="5.6" x2="7.1" y2="7.1" strokeWidth="1.25" />
      <line x1="18.4" y1="5.6" x2="16.9" y2="7.1" strokeWidth="1.25" />
      <line x1="5.6" y1="18.4" x2="7.1" y2="16.9" strokeWidth="1.25" />
      <line x1="18.4" y1="18.4" x2="16.9" y2="16.9" strokeWidth="1.25" />
    </Svg>
  );
}

// 🕶️ Black Market — hooded shadow figure with coin
export function BlackMarketFactionIcon({ size = 24, color = 'currentColor', className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Hood outline */}
      <path d="M12 2 Q5 4 5 10 Q5 14 8 15.5 L8 19 Q10 20 12 20 Q14 20 16 19 L16 15.5 Q19 14 19 10 Q19 4 12 2z" strokeWidth="1.75" />
      {/* Face shadow — dark visor */}
      <path d="M8.5 10 Q10 8.5 12 8.5 Q14 8.5 15.5 10 Q15.5 12.5 12 12.5 Q8.5 12.5 8.5 10z" strokeWidth="1" />
      {/* Coin in hand */}
      <circle cx="12" cy="22" r="1.75" strokeWidth="1.5" />
      <line x1="12" y1="20.25" x2="12" y2="19" strokeWidth="1.25" />
      {/* Shadow cloak edges */}
      <path d="M8 15.5 Q6 17 6 19" strokeWidth="1.25" />
      <path d="M16 15.5 Q18 17 18 19" strokeWidth="1.25" />
    </Svg>
  );
}

// ── Universe 2 Faction icons ──────────────────────────────────────────────────

// 🕰️ Chroniclers — temporal eye with clock hands (entity + echo observers)
export function ChroniclersFactionIcon({ size = 24, color = 'currentColor', className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Outer circle (clock face) */}
      <circle cx="12" cy="12" r="9" strokeWidth="1.5" />
      {/* Eye lids */}
      <path d="M4.5 12 Q8 8 12 8 Q16 8 19.5 12" strokeWidth="1.25" />
      <path d="M4.5 12 Q8 16 12 16 Q16 16 19.5 12" strokeWidth="1.25" />
      {/* Pupil */}
      <circle cx="12" cy="12" r="2" strokeWidth="1.25" />
      <circle cx="12" cy="12" r="0.75" fill={color} stroke="none" />
      {/* Clock hour hand */}
      <line x1="12" y1="12" x2="12" y2="7.5" strokeWidth="1.75" />
      {/* Clock minute hand */}
      <line x1="12" y1="12" x2="15" y2="12" strokeWidth="1.25" />
    </Svg>
  );
}

// 💠 Void Seekers — prism with rift crack (relic + rift hunters)
export function VoidSeekersFactionIcon({ size = 24, color = 'currentColor', className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Outer diamond */}
      <polygon points="12,2 21,11 12,22 3,11" strokeWidth="1.75" />
      {/* Inner gem facets */}
      <line x1="3" y1="11" x2="21" y2="11" strokeWidth="1" />
      <line x1="12" y1="2" x2="3" y2="11" strokeWidth="1" />
      <line x1="12" y1="2" x2="21" y2="11" strokeWidth="1" />
      {/* Rift crack */}
      <path d="M10 8 L13 12 L11 16" strokeWidth="1.25" />
      {/* Light ray */}
      <line x1="21" y1="11" x2="23.5" y2="9" strokeWidth="1.25" />
    </Svg>
  );
}

// 〰️ Resonators — concentric resonance rings with signal spikes (expeditions + asteroids)
export function ResonatorsFactionIcon({ size = 24, color = 'currentColor', className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Outer dashed ring */}
      <circle cx="12" cy="12" r="9.5" strokeWidth="1.25" strokeDasharray="3 2" />
      {/* Middle ring */}
      <circle cx="12" cy="12" r="6" strokeWidth="1.5" />
      {/* Inner ring */}
      <circle cx="12" cy="12" r="2.5" strokeWidth="1.25" />
      {/* Center dot */}
      <circle cx="12" cy="12" r="0.75" fill={color} stroke="none" />
      {/* Cardinal signal spikes */}
      <line x1="12" y1="2.5" x2="12" y2="0.5" strokeWidth="1.75" />
      <line x1="21.5" y1="12" x2="23.5" y2="12" strokeWidth="1.75" />
      <line x1="12" y1="21.5" x2="12" y2="23.5" strokeWidth="1.75" />
      <line x1="2.5" y1="12" x2="0.5" y2="12" strokeWidth="1.75" />
    </Svg>
  );
}

// 🚚 Haulers — cargo container with cross-universe route arrows
export function HaulersFactionIcon({ size = 24, color = 'currentColor', className, style }) {
  return (
    <Svg size={size} color={color} className={className} style={style}>
      {/* Cargo container body */}
      <rect x="2" y="7" width="14" height="9" rx="1.5" strokeWidth="1.75" />
      {/* Container division */}
      <line x1="9" y1="7" x2="9" y2="16" strokeWidth="1" />
      {/* Wheels */}
      <circle cx="5" cy="17.5" r="1.5" strokeWidth="1.25" />
      <circle cx="13" cy="17.5" r="1.5" strokeWidth="1.25" />
      {/* Forward arrow (cross-universe direction) */}
      <polyline points="17,10 21,12 17,14" strokeWidth="1.75" />
      {/* Route dashes */}
      <line x1="16" y1="12" x2="18.5" y2="12" strokeWidth="1.25" strokeDasharray="2 1.5" />
    </Svg>
  );
}

// Faction icon map — keyed by faction id from API
const FACTION_ICON_MAP = {
  // U1
  bioengineers:     BioengineersFactionIcon,
  tech_institute:   TechInstituteFactionIcon,
  navigators_order: NavigatorsOrderFactionIcon,
  black_market:     BlackMarketFactionIcon,
  // U2
  chroniclers:      ChroniclersFactionIcon,
  void_seekers:     VoidSeekersFactionIcon,
  resonators:       ResonatorsFactionIcon,
  haulers:          HaulersFactionIcon,
};

export function FactionIcon({ factionId, size = 22, color = 'currentColor', className, style }) {
  const IconComponent = FACTION_ICON_MAP[factionId];
  if (!IconComponent) {
    // Fallback: generic faction shield
    return (
      <Svg size={size} color={color} className={className} style={style}>
        <path d="M12 2L4 6v6c0 5.5 3.6 10.7 8 12 4.4-1.3 8-6.5 8-12V6z" />
      </Svg>
    );
  }
  return <IconComponent size={size} color={color} className={className} style={style} />;
}

// ─── Item type icon wrapper ───────────────────────────────────────────────────
// Maps find_type string → correct icon component

import { Eye, Gift } from 'lucide-react';

const TYPE_ICON_COMPONENTS = {
  debris:        DebrisIcon,
  artifact:      ArtifactIcon,
  creature:      CreatureIcon,
  anomaly:       AnomalyIcon,
  asteroid:      AsteroidIcon,
  nft_container: Gift,
  story_item:    SignalAmplifierIcon,
  echo:          EchoIcon,
  relic:         RelicStatueIcon,
  entity:        Eye,
  rift:          RiftIcon,
};

export function ItemTypeIcon({ type, size = 24, color = 'currentColor', className, style }) {
  const IconComponent = TYPE_ICON_COMPONENTS[type];
  if (!IconComponent) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" aria-hidden="true" className={className} style={style}>
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <circle cx="12" cy="16" r="0.5" fill={color} />
      </svg>
    );
  }
  return <IconComponent size={size} color={color} className={className} style={style} />;
}
