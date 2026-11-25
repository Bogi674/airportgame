import type { ComponentChildren } from 'preact';

export type IconName =
  | 'select' | 'runway' | 'taxiway' | 'taxilane' | 'rapidExit' | 'parallel' | 'apron' | 'stands' | 'gaBlock' | 'terminal' | 'tower' | 'demolish'
  | 'undo' | 'redo' | 'airlines' | 'finance' | 'flights' | 'site' | 'parcels' | 'menu' | 'pause' | 'play' | 'sun' | 'moon' | 'close' | 'handling' | 'flightops' | 'infra' | 'staff' | 'zoning' | 'lock' | 'overlay' | 'settings' | 'options' | 'bell' | 'skip'
  | 'foundation' | 'floor' | 'wall' | 'door' | 'fixture' | 'erase' | 'zone'
  | 'navaids' | 'stations' | 'commercial' | 'bulldoze' | 'area' | 'build' | 'land' | 'tenants' | 'reports' | 'map' | 'plane' | 'stand' | 'star' | 'cloud' | 'rain' | 'check' | 'warning';

const P: Record<IconName, ComponentChildren> = {
  select: <path d="M6 4l12 7-5.5 1.5L10 18z" />,
  runway: (<><path d="M9 2.500h6l4 19H5z" /><path d="M12 5v2.500M12 10.500V13M12 16.500V19" strokeDasharray="0" /><path d="M8.500 20h7" /></>),
  taxiway: (<><path d="M3 20c0-8 4-9 9-9s9-1 9-8" /><path d="M7 20c0-5 2-6 5-6s6-.5 6-6" strokeDasharray="1.800 2.200" /><path d="M2 17h5M17 3h5" /></>),
  taxilane: <path d="M3 12h18M3 12h3M9 12h3M15 12h3" strokeDasharray="3 3" />,
  rapidExit: (<><path d="M3 15h18" /><path d="M9 15c4 0 5-6 11-8" /></>),
  parallel: (<><path d="M3 7h18M3 17h18" /><path d="M7 7v10M17 7v10" /></>),
  apron: (<><rect x="3" y="4" width="18" height="16" rx="1.500" /><path d="M9 4v6M15 4v6M3 14h18" strokeDasharray="2 2" /><path d="M12 12v5M10 15l2 2 2-2" /></>),
  stands: (<><path d="M5 20V7h14v13" strokeDasharray="0" /><path d="M12 6l-1 4-5 3v1.500l5-1 .5 3.500-2 1.500V20l2.500-.8 2.500.8v-1.500l-2-1.500.5-3.500 5 1V13l-5-3z" /></>),
  gaBlock: (<><path d="M4 19V8M12 19V8M20 19V8" /><path d="M4 6l2 2M12 6l2 2M20 6l2 2" /><path d="M2 19h20" /></>),
  terminal: (<><path d="M2 20h20" /><path d="M4 20v-7l8-4 8 4v7" /><path d="M8 20v-4h3v4M13 20v-4h3v4" /><path d="M12 9V4M10.500 4h3" /></>),
  tower: (<><path d="M4 21h16" /><path d="M9.500 21l1.500-10h2l1.500 10" /><path d="M7 8h10l-1-3H8z" /><path d="M12 5V2" /><path d="M9 11h6" /></>),
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
  handling: (<><path d="M2 16V9h8v7M10 11.500h5l3 3v1.500" /><circle cx="6" cy="17.500" r="1.800" /><circle cx="15" cy="17.500" r="1.800" /><path d="M2 16h16M18 16v1.500" /><path d="M19.500 8l2 2-2 2" /></>),
  flightops: (<><path d="M3 11l8-3 7-6 1.500 1.500-3.500 7 3 5-1.500 1.500-4.500-3-3 2.500-2-1 1-4z" /><circle cx="18" cy="18" r="3.500" /><path d="M18 16.200V18l1.300.8" /></>),
  infra: (<><path d="M2 19h20" /><path d="M3 19v-9h11v9" /><path d="M14 13h4l3 3v3" /><circle cx="7" cy="19" r="1.700" /><circle cx="17.500" cy="19" r="1.700" /><path d="M6 12.500h5" /></>),
  staff: (<><circle cx="9" cy="7.500" r="3" /><path d="M3 20v-1.500c0-3 2.700-5 6-5s6 2 6 5V20" /><circle cx="17.500" cy="9" r="2.200" /><path d="M17 13.500c2.500 0 4.500 1.600 4.500 4.500V19" /></>),
  zoning: (<><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" strokeDasharray="2.500 2" /><rect x="3" y="13" width="8" height="8" rx="1" strokeDasharray="2.500 2" /><rect x="13" y="13" width="8" height="8" rx="1" /><path d="M5.500 7h3M15.500 17h3" /></>),
  lock: (<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>),
  overlay: (<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100" /></>),
  options: <path d="M4 8h10M18 8h2M4 16h2M10 16h10M14 6v4M6 14v4" />,
  skip: <path d="M4 6l7 6-7 6zM12 6l7 6-7 6zM20 5v14" />,
  bell: (<><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></>),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  foundation: (<><path d="M3 16l9-5 9 5-9 5z" /><path d="M3 12l9-5 9 5" /></>),
  floor: (<><rect x="4" y="4" width="16" height="16" /><path d="M4 12h16M12 4v16" /></>),
  wall: (<><path d="M3 6h18v12H3z" /><path d="M3 12h18M9 6v6M15 12v6" /></>),
  door: (<><path d="M6 20V5h12v15M4 20h16" /><circle cx="15" cy="13" r=".8" /></>),
  fixture: (<><rect x="4" y="9" width="16" height="7" rx="1" /><path d="M7 9V6h10v3M7 16v2M17 16v2" /></>),
  zone: (<><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" strokeDasharray="2 2" /><rect x="4" y="13" width="7" height="7" strokeDasharray="2 2" /><rect x="13" y="13" width="7" height="7" /></>),
  erase: <path d="M4 16l8-9 8 7-5 5H8zM9 21h11" />,
  navaids: (<><path d="M12 11v10M9 21h6" /><circle cx="12" cy="9" r="2" /><path d="M7.800 4.800a6 6 0 000 8.400M16.200 4.800a6 6 0 010 8.400" /></>),
  stations: (<><path d="M3 10h18M5 10v9M19 10v9M3 19h18" /><path d="M9 14h6" /><path d="M6 10l2-5h8l2 5" /></>),
  commercial: (<><path d="M6 8h12l-1 12H7z" /><path d="M9 8V6a3 3 0 016 0v2" /></>),
  bulldoze: (<><path d="M3 15V9h7l2 3h3v3" /><path d="M15 9l3-3M18 6l3 6v5h-3" /><circle cx="6" cy="17" r="2" /><circle cx="12" cy="17" r="2" /></>),
  area: <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2.500" />,
  build: <path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4" />,
  land: (<><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>),
  tenants: (<><path d="M6 8h12l-1 12H7z" /><path d="M9 8V6a3 3 0 016 0v2" /></>),
  reports: (<><path d="M4 20V4M4 20h16" /><path d="M7 15l4-4 3 3 5-6" /></>),
  map: (<><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>),
  plane: <path d="M21 15.500l-8-4.500V5a1.500 1.500 0 00-3 0v6l-8 4.500V17l8-2v4l-2 1.500V22l3.500-1 3.500 1v-1.500L13 19v-4l8 2z" />,
  stand: (<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></>),
  star: <path d="M12 3l2.700 5.600 6.100.9-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100L3.200 9.500l6.100-.9z" />,
  cloud: <path d="M7 18h10a4 4 0 00.5-8 6 6 0 00-11.500 1.500A3.300 3.300 0 007 18z" />,
  rain: (<><path d="M7 15h10a4 4 0 00.5-8 6 6 0 00-11.500 1.500A3.300 3.300 0 007 15z" /><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" /></>),
  check: <path d="M5 12.500l4.500 4.500L19 7" />,
  warning: (<><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>),
};

/** Outline icon on a 24 unit grid, stroked with currentColor. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
