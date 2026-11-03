import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { Renderer } from '@render/renderer';
import type { Preset } from '@shared/site';
import { SPEEDS, type Speed } from '@shared/time';
import { SimClient } from '../worker/client';
import { MapView } from './MapView';
import { Minimap } from './Minimap';
import { SitePanel } from './SitePanel';
import { ContextBar } from './ContextBar';
import { ObjectPanel } from './ObjectPanel';
import { ToolRail } from './ToolRail';
import { useGameStore } from './stores/gameStore';
import { t } from './strings';

const DEFAULT_SEED = 'GOLDEN-0001';
const DEFAULT_PRESET: Preset = 'flatCoastal';
const NOTICE_MS = 4000;

export function App() {
  const store = useGameStore();
  (window as unknown as { __store?: typeof useGameStore }).__store = useGameStore;
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const client = useMemo(
    () =>
      new SimClient({
        onPerf: (report) => useGameStore.getState().setPerf(report, client.tick),
        onError: (message) => useGameStore.getState().setError(message),
        onSite: (site) => useGameStore.getState().setSite(site),
        onOwnership: (o) => useGameStore.getState().setOwnership(o.owner, o.cash),
        onAirfield: (m) => useGameStore.getState().setAirfield(m.airfield, m.canUndo, m.canRedo),
        onEvents: (list) => {
          const code = list[list.length - 1];
          if (!code) return;
          useGameStore.getState().setNotice(code);
          setTimeout(() => {
            if (useGameStore.getState().notice?.code === code.split('|')[0]) useGameStore.getState().setNotice(null);
          }, NOTICE_MS);
        },
      }),
    [],
  );

  useEffect(() => {
    client.init(DEFAULT_SEED, { preset: DEFAULT_PRESET });
    return () => client.dispose();
  }, [client]);

  const onRenderer = useCallback((r: Renderer | null) => {
    (window as unknown as { __renderer?: Renderer | null }).__renderer = r;
    setRenderer(r);
  }, []);

  const onPick = useCallback((id: number) => useGameStore.getState().selectParcel(id), []);

  // A new site resets the renderer and frames the corridor the generator guarantees.
  useEffect(() => {
    if (!renderer || !store.site) return;
    renderer.setSite(store.site);
    const c = store.site.corridor;
    renderer.camera.x = c.cx;
    renderer.camera.y = c.cy;
    renderer.camera.faceNorth();
    renderer.camera.setZoom(0.2);
  }, [renderer, store.site]);

  useEffect(() => {
    if (renderer && store.owner) renderer.setOwnership(store.owner);
  }, [renderer, store.site, store.owner]);

  useEffect(() => {
    renderer?.setAirfield(store.airfield);
  }, [renderer, store.airfield]);

  useEffect(() => {
    renderer?.setSelectedParcel(store.selectedParcel);
  }, [renderer, store.site, store.selectedParcel]);

  useEffect(() => {
    renderer?.setParcelOverlayVisible(store.parcelOverlay);
  }, [renderer, store.parcelOverlay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        client.send({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        client.send({ type: 'redo' });
      } else if (e.key === 'p' || e.key === 'P') useGameStore.getState().toggleParcelOverlay();
      else if (e.key === 'Escape') useGameStore.getState().selectParcel(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [client]);

  const setSpeed = (s: Speed): void => {
    store.setSpeed(s);
    client.setSpeed(s);
  };

  const setTraffic = (perHour: number): void => client.send({ type: 'setTestTraffic', perHour, turnScale: 0.2 });

  return (
    <div style="position:relative;width:100%;height:100%;font:13px system-ui,sans-serif;color:#dfe7ec">
      <MapView client={client} onRenderer={onRenderer} onPick={onPick} />
      <div
        data-testid="hud"
        style="position:absolute;top:8px;left:8px;padding:8px 10px;background:#10161ce6;border:1px solid #2c3a45;border-radius:6px"
      >
        <div>{t('app.title')}</div>
        <div data-testid="tick">
          {t('hud.tick')}: {store.tick}
        </div>
        <div>
          {t('hud.aircraft')}: {store.aircraftCount}
        </div>
        <div>
          {t('hud.simMs')}: {store.simMsPerTick.toFixed(3)}
        </div>
        <div>
          {t('hud.backlog')}: {store.tickBacklog}
        </div>
        <div style="display:flex;gap:4px;margin-top:6px">
          {SPEEDS.map((s) => (
            <button key={s} data-testid={`speed-${s}`} aria-pressed={store.speed === s} onClick={() => setSpeed(s)}>
              {s === 0 ? t('hud.pause') : `${s}x`}
            </button>
          ))}
        </div>
        <div style="display:flex;gap:4px;margin-top:6px">
          <button data-testid="spawn" onClick={() => setTraffic(30)}>
            {t('hud.spawn')}
          </button>
          <button onClick={() => setTraffic(0)}>{t('hud.clear')}</button>
        </div>
        <div style="margin-top:6px">
          <button data-testid="parcel-toggle" aria-pressed={store.parcelOverlay} onClick={() => store.toggleParcelOverlay()}>
            {t('hud.parcels')}
          </button>
        </div>
        {store.error && (
          <div role="alert" style="margin-top:6px;color:#ff8f8f">
            {t('error.title')}: {store.error}
          </div>
        )}
      </div>
      <SitePanel
        onNewGame={(seed, preset) => {
          store.selectParcel(-1);
          client.init(seed, { preset });
        }}
        onBuy={(id) => client.send({ type: 'buyParcel', parcelId: id })}
      />
      <ToolRail onUndo={() => client.send({ type: 'undo' })} onRedo={() => client.send({ type: 'redo' })} />
      <ObjectPanel send={(c) => client.send(c)} />
      <ContextBar send={(c) => client.send(c)} />
      {store.site && <Minimap renderer={renderer} site={store.site} owner={store.owner} />}
    </div>
  );
}

