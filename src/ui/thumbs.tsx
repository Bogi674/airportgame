import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './icons';

const PAVE = '#4b4f57';
const LINE = '#e9b92f';
const WHITE = '#f2f4f6';
const GRASS = '#7f9f55';

function Scene({ children, bg = GRASS }: { children: ComponentChildren; bg?: string }) {
  return (
    <svg viewBox="0 0 96 60" width="100%" height="100%" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width="96" height="60" fill={bg} />
      {children}
    </svg>
  );
}

const plane = (x: number, y: number, rot = 0, s = 1) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
    <path d="M-12 0 L-6 -2 L-2 -12 L1 -12 L0 -2 L8 -2 L10 -4 L12 -4 L11 0 L12 4 L10 4 L8 2 L0 2 L1 12 L-2 12 L-6 2 Z" fill="#eef1f4" stroke="#9aa4ae" stroke-width="0.6" />
  </g>
);

const truck = (x: number, y: number, color: string, w = 16, h = 8) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x="0" y="0" width={w} height={h} rx="1.800" fill={color} stroke="rgba(0,0,0,0.35)" stroke-width="0.6" />
    <rect x={w - 5} y="1" width="4" height={h - 2} rx="1" fill="rgba(20,30,40,0.55)" />
  </g>
);

/** Small illustrations for the build menu cards. Unknown kinds fall back to the icon. */
export function Thumb({ kind, icon }: { kind: string; icon: IconName }) {
  switch (kind) {
    case 'runway':
      return (
        <Scene>
          <rect x="-4" y="22" width="104" height="16" fill={PAVE} />
          {[8, 26, 44, 62, 80].map((x) => <rect key={x} x={x} y="29.300" width="10" height="1.400" fill={WHITE} />)}
          <rect x="4" y="24" width="2" height="12" fill={WHITE} />
          <rect x="8" y="24" width="2" height="12" fill={WHITE} />
        </Scene>
      );
    case 'runwayExtend':
      return (
        <Scene>
          <rect x="-4" y="22" width="60" height="16" fill={PAVE} />
          <rect x="56" y="22" width="44" height="16" fill={PAVE} opacity="0.5" stroke={WHITE} stroke-dasharray="3 2" stroke-width="0.8" />
          <path d="M60 30h26M80 25l6 5-6 5" stroke={LINE} fill="none" stroke-width="1.800" />
        </Scene>
      );
    case 'runwayShorten':
      return (
        <Scene>
          <rect x="-4" y="22" width="60" height="16" fill={PAVE} />
          <rect x="56" y="22" width="44" height="16" fill="#b04a42" opacity="0.55" />
          <path d="M80 30H56M62 25l-6 5 6 5" stroke={WHITE} fill="none" stroke-width="1.800" />
        </Scene>
      );
    case 'taxiway':
      return (
        <Scene>
          <path d="M-4 46H40C56 46 54 14 70 14H100" stroke={PAVE} stroke-width="11" fill="none" />
          <path d="M-4 46H40C56 46 54 14 70 14H100" stroke={LINE} stroke-width="1" fill="none" />
        </Scene>
      );
    case 'taxiCut':
      return (
        <Scene>
          <path d="M-4 30H100" stroke={PAVE} stroke-width="11" />
          <rect x="36" y="18" width="24" height="24" fill={GRASS} />
          <path d="M-4 30H36M60 30H100" stroke={LINE} stroke-width="1" />
          <path d="M40 22l16 16M56 22L40 38" stroke="#e04c3c" stroke-width="1.600" />
        </Scene>
      );
    case 'taxiTrim':
      return (
        <Scene>
          <path d="M-4 30H62" stroke={PAVE} stroke-width="11" />
          <path d="M62 30H100" stroke="#b04a42" stroke-width="11" opacity="0.55" />
          <path d="M-4 30H62" stroke={LINE} stroke-width="1" />
        </Scene>
      );
    case 'rapidExit':
      return (
        <Scene>
          <rect x="-4" y="6" width="104" height="14" fill={PAVE} />
          <path d="M30 20C42 22 52 30 70 50" stroke={PAVE} stroke-width="9" fill="none" />
          <path d="M30 20C42 22 52 30 70 50" stroke={LINE} stroke-width="1" fill="none" />
        </Scene>
      );
    case 'parallel':
      return (
        <Scene>
          <rect x="-4" y="8" width="104" height="10" fill={PAVE} />
          <rect x="-4" y="40" width="104" height="8" fill={PAVE} />
          {[20, 48, 76].map((x) => <rect key={x} x={x} y="18" width="6" height="22" fill={PAVE} />)}
        </Scene>
      );
    case 'apron':
      return (
        <Scene>
          <rect x="8" y="8" width="80" height="44" rx="3" fill="#8a8f97" stroke="#b9bec5" stroke-width="1" />
          <path d="M8 30H88" stroke={LINE} stroke-width="0.8" stroke-dasharray="3 2" />
        </Scene>
      );
    case 'stand':
      return (
        <Scene bg="#8a8f97">
          {[16, 48, 80].map((x) => (
            <g key={x}>
              <rect x={x - 11} y="10" width="22" height="40" fill="none" stroke="#d6453b" stroke-width="1" />
              <path d={`M${x} -2V20`} stroke={LINE} stroke-width="1" />
              {plane(x, 32, 90, 0.8)}
            </g>
          ))}
        </Scene>
      );
    case 'gaBlock':
      return (
        <Scene bg="#8a8f97">
          {[18, 48, 78].map((x) => <g key={x}><rect x={x - 9} y="14" width="18" height="30" fill="none" stroke="#e6e8ea" stroke-width="0.8" />{plane(x, 30, 90, 0.55)}</g>)}
        </Scene>
      );
    case 'foundation':
      return <Scene bg="#6f7f55"><rect x="14" y="10" width="68" height="40" fill="#8b8f94" stroke="#555" stroke-width="1.200" /></Scene>;
    case 'floor':
      return (
        <Scene bg="#6f7f55">
          <rect x="14" y="10" width="68" height="40" fill="#d3dadd" />
          {[26, 38, 50, 62, 74].map((x) => <path key={x} d={`M${x} 10V50`} stroke="rgba(0,0,0,0.12)" />)}
          {[22, 34, 46].map((y) => <path key={y} d={`M14 ${y}H82`} stroke="rgba(0,0,0,0.12)" />)}
        </Scene>
      );
    case 'wall':
      return <Scene bg="#d3dadd"><path d="M10 30H86" stroke="#37424c" stroke-width="4" /></Scene>;
    case 'door':
      return <Scene bg="#d3dadd"><path d="M10 30H36M60 30H86" stroke="#37424c" stroke-width="4" /><path d="M36 30h24" stroke="#c58f3a" stroke-width="4" /></Scene>;
    case 'erase':
      return <Scene bg="#d3dadd"><path d="M30 18l36 24M66 18L30 42" stroke="#e04c3c" stroke-width="3" /></Scene>;
    case 'checkIn':
      return <Scene bg="#d3dadd">{[16, 38, 60].map((x) => <rect key={x} x={x} y="20" width="16" height="22" rx="2" fill="#3f7fd8" />)}</Scene>;
    case 'security':
      return <Scene bg="#d3dadd">{[14, 40, 66].map((x) => <g key={x}><rect x={x} y="14" width="14" height="32" rx="2" fill="#e08a2e" /><rect x={x + 4} y="20" width="6" height="20" fill="rgba(255,255,255,0.5)" /></g>)}</Scene>;
    case 'belt':
      return <Scene bg="#d3dadd"><rect x="10" y="22" width="76" height="16" rx="8" fill="#8b95a0" /><rect x="18" y="26" width="10" height="8" fill="#c9a36a" /><rect x="48" y="26" width="12" height="8" fill="#6a89c9" /></Scene>;
    case 'seating':
      return <Scene bg="#d3dadd">{[14, 30, 46, 62].map((x) => <rect key={x} x={x} y="24" width="12" height="12" rx="3" fill="#3aa89a" />)}</Scene>;
    case 'toilet':
      return <Scene bg="#d3dadd"><rect x="22" y="14" width="22" height="32" rx="3" fill="#9a5cc8" /><rect x="52" y="14" width="22" height="32" rx="3" fill="#b88ad8" /></Scene>;
    case 'shop':
      return <Scene bg="#d3dadd"><rect x="16" y="14" width="64" height="32" rx="3" fill="#e0a030" /><rect x="24" y="22" width="48" height="12" fill="rgba(255,255,255,0.5)" /><path d="M14 14h68l-4-6H18z" fill="#d85c5c" /></Scene>;
    case 'atc':
      return <Scene bg="#6f7f55"><rect x="38" y="24" width="20" height="30" fill="#aeb4ba" /><rect x="32" y="12" width="32" height="14" rx="3" fill="#4ab0b8" stroke="#2c7a82" /></Scene>;
    case 'zonePublic':
    case 'zoneCommercial':
    case 'zoneSecure':
    case 'zoneStaff': {
      const c = { zonePublic: '#468ce6', zoneCommercial: '#ebaa32', zoneSecure: '#46be78', zoneStaff: '#dc5050' }[kind];
      return <Scene bg="#d3dadd"><rect x="12" y="10" width="72" height="40" rx="3" fill={c} opacity="0.55" stroke={c} stroke-width="1.500" /></Scene>;
    }
    case 'tug':
    case 'tractor':
    case 'cart':
    case 'beltloader':
    case 'catering':
    case 'dispenser':
    case 'refueller':
    case 'gpu':
    case 'bus':
    case 'stairs': {
      const color = { tug: '#d9a21b', tractor: '#c2452d', cart: '#8a96a0', beltloader: '#e6e8ea', catering: '#d8dde2', dispenser: '#cf5c1d', refueller: '#e2e5e8', gpu: '#2f7fc1', bus: '#e1b12c', stairs: '#cfd3d6' }[kind];
      return <Scene bg="#8a8f97">{truck(26, 22, color, 40, 16)}{kind === 'tractor' ? truck(70, 24, '#8a96a0', 14, 12) : null}</Scene>;
    }
    default:
      return (
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted)">
          <Icon name={icon} size={30} />
        </div>
      );
  }
}
