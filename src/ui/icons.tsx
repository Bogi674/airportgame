import type { ComponentChildren } from 'preact';

export type IconName =
  | 'select' | 'runway' | 'taxiway' | 'taxilane' | 'rapidExit' | 'parallel' | 'apron' | 'stands' | 'gaBlock' | 'terminal' | 'demolish'
  | 'undo' | 'redo' | 'airlines' | 'finance' | 'flights' | 'site' | 'parcels' | 'menu' | 'pause' | 'play' | 'sun' | 'moon' | 'close' | 'overlay' | 'settings' | 'options'
  | 'foundation' | 'floor' | 'wall' | 'door' | 'fixture' | 'erase' | 'zone';

const P: Record<IconName, ComponentChildren> = {
  select: <path d="M6 4l12 7-5.5 1.5L10 18z" />,
  runway: (<><path d="M3 18L9 6h6l6 12z" /><path d="M12 8v2M12 12v2M12 16v1" /></>),
  taxiway: (<><path d="M4 18c6 0 4-12 10-12h6" /><path d="M4 18c6 0 4-12 10-12" strokeDasharray="2 2" /></>),
  taxilane: <path d="M3 12h18M3 12h3M9 12h3M15 12h3" strokeDasharray="3 3" />,
  rapidExit: (<><path d="M3 15h18" /><path d="M9 15c4 0 5-6 11-8" /></>),
  parallel: (<><path d="M3 7h18M3 17h18" /><path d="M7 7v10M17 7v10" /></>),
  apron: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  stands: (<><path d="M12 3v4M12 7l-6 6 3 .5.5 3.5L12 14l2.5 3 .5-3.5 3-.5z" /></>),
  gaBlock: (<><path d="M5 18l3-8 3 8M13 18l3-8 3 8" /><path d="M3 18h18" /></>),
  terminal: (<><path d="M4 20V9l8-5 8 5v11z" /><path d="M9 20v-6h6v6" /></>),
  demolish: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" />,
  undo: <path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 7" />,
  redo: <path d="M15 7l5 5-5 5M20 12H10a6 6 0 000 7" />,
  airlines: <path d="M3 13l18-8-4 15-5-5-3 4v-5z" />,
  finance: (<><circle cx="12" cy="12" r="8" /><path d="M14.5 9.5c-.5-1-1.500-1.500-2.500-1.500-1.500 0-2.500.8-2.500 2s1 1.600 2.500 2 2.500.8 2.500 2-1 2-2.500 2c-1.200 0-2.200-.6-2.700-1.700M12 6.500V8M12 16v1.500" /></>),
  flights: (<><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="7" cy="6" r=".6" /><circle cx="7" cy="12" r=".6" /><circle cx="7" cy="18" r=".6" /></>),
  site: (<><path d="M12 21s-6-5.500-6-10a6 6 0 0112 0c0 4.500-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></>),
  parcels: (<><path d="M4 4h16v16H4z" /><path d="M4 12h16M12 4v16" /></>),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M8 5l11 7-11 7z" />,
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600l1.400 1.400M17 17l1.400 1.400M5.600 18.400L7 17M17 7l1.400-1.400" /></>),
  moon: <path d="M20 14.500A8 8 0 019.500 4 8 8 0 1020 14.500z" />,
  overlay: (<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100" /></>),
  options: <path d="M4 8h10M18 8h2M4 16h2M10 16h10M14 6v4M6 14v4" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  foundation: (<><path d="M3 16l9-5 9 5-9 5z" /><path d="M3 12l9-5 9 5" /></>),
  floor: (<><rect x="4" y="4" width="16" height="16" /><path d="M4 12h16M12 4v16" /></>),
  wall: (<><path d="M3 6h18v12H3z" /><path d="M3 12h18M9 6v6M15 12v6" /></>),
  door: (<><path d="M6 20V5h12v15M4 20h16" /><circle cx="15" cy="13" r=".8" /></>),
  fixture: (<><rect x="4" y="9" width="16" height="7" rx="1" /><path d="M7 9V6h10v3M7 16v2M17 16v2" /></>),
  zone: (<><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" strokeDasharray="2 2" /><rect x="4" y="13" width="7" height="7" strokeDasharray="2 2" /><rect x="13" y="13" width="7" height="7" /></>),
  erase: <path d="M4 16l8-9 8 7-5 5H8zM9 21h11" />,
};

/** Outline icon on a 24 unit grid, stroked with currentColor. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
