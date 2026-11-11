import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Renderer } from '@render/renderer';
import type { Command } from '@sim/commands';
import type { TerminalGrid } from '@shared/business';
import type { GameOptions, WalkGraphView } from '@shared/protocol';
import type { Preset } from '@shared/site';
import type { Speed } from '@shared/time';
import { SimClient } from '../worker/client';
import { alertText, ALERT_CODES, parseEvent } from './alerts';
import { BuildMenu } from './BuildMenu';
import { ConfirmPopup } from './ConfirmPopup';
import { ContextBar } from './ContextBar';
import { CrashPanel } from './CrashPanel';
import { Guide } from './Guide';
import { MapView } from './MapView';
import { Menu } from './Menu';
import { Minimap } from './Minimap';
import { ObjectPanel } from './ObjectPanel';
import { ParcelPanel } from './ParcelPanel';
import { PauseMenu } from './PauseMenu';
import { exportToFile, importFromFile, loadSave, putSave } from './saves';
import { Sheets } from './Sheets';
import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { Toasts } from './Toasts';
import { ToolRail } from './ToolRail';
import { TopBar } from './TopBar';
import { t, tFormat } from './strings';

const ALERT_MS = 9000;
const AUTOSAVE_KEY = 'airfield.autosave';

interface Pending {
  auto: boolean;
  toFile: boolean;
}

function readAutosave(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function App() {
  const store = useGameStore();
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [autosave, setAutosave] = useState(readAutosave);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const pending = useRef(new Map<number, Pending>());
  const saveId = useRef(1);
  const speedBefore = useRef<Speed>(1);
  const lastAutoDay = useRef(-1);
  const rendererRef = useRef<Renderer | null>(null);
  /** The walk graph query in flight: its id and the grid it was asked for, so a stale answer is ignored. */
  const walkQuery = useRef<{ id: number; grid: TerminalGrid } | null>(null);
  const walkQueryId = useRef(0);
  const selection = useToolStore((s) => s.selection);

  const client = useMemo(
    () =>
      new SimClient({
        onPerf: (report) => useGameStore.getState().setPerf(report, client.tick),
        onError: (message) => useGameStore.getState().setError(message),
        onCrash: (c) => useGameStore.getState().setCrash(c),
        onSite: (site) => useGameStore.getState().setSite(site),
        onOwnership: (o) => useGameStore.getState().setOwnership(o.owner, o.cash),
        onAirfield: (m) => useGameStore.getState().setAirfield(m.airfield, m.canUndo, m.canRedo),
        onBusiness: (b) => {
          const s = useGameStore.getState();
          const prev = s.business;
          s.setBusiness(b);
          // Alert once when the queue starts to build, not on every update while it stays long.
          if ((prev === null || prev.atcQueue === 0) && b.atcQueue > 0) s.pushAlert(tFormat('alert.atcOverload', { n: String(b.atcQueue) }), 'warn');
        },
        onTerminals: (g) => useGameStore.getState().setTerminalGrids(g),
        onQueryResult: (id, data) => {
          const req = walkQuery.current;
          if (req && req.id === id && data !== null) rendererRef.current?.setWalkGraph(data as WalkGraphView, req.grid);
        },
        onEvents: (list) => {
          for (const code of list) {
            const { name } = parseEvent(code);
            if (ALERT_CODES.has(name)) {
              const a = alertText(code);
              const s = useGameStore.getState();
              s.pushAlert(a.text, a.tone);
              const latest = useGameStore.getState().alerts;
              const id = latest[latest.length - 1]?.id;
              if (id !== undefined) setTimeout(() => useGameStore.getState().dismissAlert(id), ALERT_MS);
            } else {
              useGameStore.getState().showNotice(code);
            }
          }
        },
        onSaved: (id, data, tick) => {
          const p = pending.current.get(id);
          pending.current.delete(id);
          if (!p) return;
          const s = useGameStore.getState();
          const day = Math.floor((tick + 360 * 600) / 864000);
          const name = p.auto ? tFormat('save.autoName', { n: day }) : tFormat('save.manualName', { seed: s.game.seed, n: day });
          if (p.toFile) {
            void exportToFile(data, `${s.game.seed}-day${day}`);
            return;
          }
          const header = {
            id: p.auto ? `auto-${s.game.seed}-${day % 3}` : `manual-${Date.now()}`,
            name,
            seed: s.game.seed,
            preset: s.game.preset,
            tick,
            cash: s.cash,
            savedAt: Date.now(),
            auto: p.auto,
          };
          void putSave(header, data).then(() => {
            if (!p.auto) {
              setSavedFlash(true);
              setTimeout(() => setSavedFlash(false), 2500);
            }
          });
        },
      }),
    [],
  );

  useEffect(() => () => client.dispose(), [client]);
  // Debug hooks for the browser tests.
  (window as unknown as { __store?: typeof useGameStore }).__store = useGameStore;
  (window as unknown as { __send?: (c: Command) => void }).__send = (c) => client.send(c);

  const startGame = useCallback(
    (seed: string, preset: Preset, saveData?: unknown) => {
      const s = useGameStore.getState();
      s.setGame(seed, preset);
      s.setScreen('game');
      s.setPauseOpen(false);
      s.setGuideHidden(saveData !== undefined);
      s.setSpeed(1);
      useToolStore.getState().set({ tool: 'select', selection: null, hint: null, problem: null, buy: null });
      lastAutoDay.current = -1;
      setMenuError(null);
      const options: GameOptions = { preset };
      client.init(seed, options, saveData);
      client.setSpeed(1);
    },
    [client],
  );

  const loadFrom = useCallback(
    async (get: () => Promise<unknown>) => {
      try {
        const raw = (await get()) as { seed?: string; options?: GameOptions };
        if (typeof raw !== 'object' || raw === null || typeof raw.seed !== 'string' || !raw.options) throw new Error('This is not an Airfield Tycoon save');
        startGame(raw.seed, raw.options.preset, raw);
      } catch (e) {
        setMenuError(e instanceof Error ? e.message : String(e));
        useGameStore.getState().setScreen('menu');
      }
    },
    [startGame],
  );

  const requestSave = (auto: boolean, toFile: boolean): void => {
    const id = saveId.current++;
    pending.current.set(id, { auto, toFile });
    client.requestSave(id);
  };

  const onRenderer = useCallback((r: Renderer | null) => {
    (window as unknown as { __renderer?: Renderer | null }).__renderer = r;
    rendererRef.current = r;
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
    renderer?.setQualityPreset(store.quality);
  }, [renderer, store.quality]);

  useEffect(() => {
    renderer?.setDebugOverlay(store.debugOverlay);
  }, [renderer, store.debugOverlay]);

  useEffect(() => {
    renderer?.setSpeed(store.speed);
  }, [renderer, store.speed]);

  useEffect(() => {
    renderer?.setTerminals(store.terminalGrids);
  }, [renderer, store.terminalGrids]);

  // The walk overlay asks the sim for the graph of the selected terminal. Grid edits change the grids state, so they ask again.
  useEffect(() => {
    if (!renderer) return;
    const grid = store.walkOverlay && selection?.kind === 'terminal' ? store.terminalGrids.find((g) => g.id === selection.id) : undefined;
    if (!grid) {
      walkQuery.current = null;
      renderer.setWalkGraph(null, null);
      return;
    }
    const id = ++walkQueryId.current;
    walkQuery.current = { id, grid };
    client.query(id, 'walkGraph', { grid: grid.id });
  }, [renderer, client, store.walkOverlay, selection, store.terminalGrids]);

  useEffect(() => {
    renderer?.setSelectedParcel(store.selectedParcel);
  }, [renderer, store.site, store.selectedParcel]);

  useEffect(() => {
    // Land mode and building are separate: entering land mode drops the tool and closes the menus.
    if (store.parcelOverlay) useToolStore.getState().set({ tool: 'select', category: null, menuOpen: false, selection: null, hint: null, problem: null, buy: null });
  }, [store.parcelOverlay]);

  useEffect(() => {
    renderer?.setParcelOverlayVisible(store.parcelOverlay);
  }, [renderer, store.parcelOverlay]);

  // Autosave once per game day into three rotating slots.
  const day = store.business?.day ?? -1;
  useEffect(() => {
    if (store.screen !== 'game' || !autosave || day <= 0 || day === lastAutoDay.current) return;
    lastAutoDay.current = day;
    requestSave(true, false);
  }, [day, autosave, store.screen]);

  // Hidden tab: pause and save, so nothing happens while the player is away.
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState !== 'hidden' || useGameStore.getState().screen !== 'game') return;
      const s = useGameStore.getState();
      if (s.speed !== 0) client.setSpeed(0);
      if (autosave) requestSave(true, false);
    };
    const onShow = (): void => {
      if (document.visibilityState === 'visible' && useGameStore.getState().screen === 'game' && !useGameStore.getState().pauseOpen) client.setSpeed(useGameStore.getState().speed);
    };
    document.addEventListener('visibilitychange', onHide);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [client, autosave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      const s = useGameStore.getState();
      if (s.screen !== 'game') return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        client.send({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        client.send({ type: 'redo' });
      } else if (e.key === 'p' || e.key === 'P') s.toggleParcelOverlay();
      else if (e.key === 'Escape') {
        const tool = useToolStore.getState();
        if (s.sheet) s.setSheet(null);
        else if (s.pauseOpen) resume();
        else if (tool.tool === 'select' && tool.selection === null) pause();
      } else if (e.key === '0') setSpeed(0);
      else if (e.key === '1') setSpeed(1);
      else if (e.key === '2') setSpeed(2);
      else if (e.key === '3') setSpeed(4);
      else if (e.key === '4') setSpeed(8);
    };
    // Capture phase, so the tool controller's own Escape handling does not hide the state this reads.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [client]);

  const setSpeed = (sp: Speed): void => {
    useGameStore.getState().setSpeed(sp);
    client.setSpeed(sp);
  };

  const pause = (): void => {
    const s = useGameStore.getState();
    speedBefore.current = s.speed;
    s.setPauseOpen(true);
    client.setSpeed(0);
  };

  const resume = (): void => {
    const s = useGameStore.getState();
    s.setPauseOpen(false);
    client.setSpeed(s.speed === 0 ? speedBefore.current || 1 : s.speed);
    if (s.speed === 0) s.setSpeed(speedBefore.current || 1);
  };

  const inGame = store.screen === 'game';
  return (
    <div style="position:relative;width:100%;height:100%;font:13px system-ui,sans-serif;color:var(--text)">
      <MapView client={client} onRenderer={onRenderer} onPick={onPick} />
      {inGame && (
        <>
          <TopBar
            onSpeed={setSpeed}
            onMenu={pause}
          />
          {!store.parcelOverlay && <ToolRail onUndo={() => client.send({ type: 'undo' })} onRedo={() => client.send({ type: 'redo' })} />}
          {!store.parcelOverlay && <Guide />}
          {!store.parcelOverlay && <ObjectPanel send={(c) => client.send(c)} />}
          {store.parcelOverlay && (
            <div data-testid="land-banner" class="panel" style="position:absolute;left:50%;top:76px;transform:translateX(-50%);padding:8px 14px;z-index:6;display:flex;gap:12px;align-items:center">
              <b style="letter-spacing:0.14em;text-transform:uppercase;font-size:11px;color:var(--accent)">{t('land.title')}</b>
              <span style="font-size:12px;color:var(--muted)">{t('land.help')}</span>
              <button data-testid="land-exit" onClick={() => useGameStore.getState().toggleParcelOverlay()}>
                {t('land.exit')}
              </button>
            </div>
          )}
          <ParcelPanel onBuy={(id) => client.send({ type: 'buyParcel', parcelId: id })} />
          {!store.parcelOverlay && <BuildMenu send={(c) => client.send(c)} />}
          {!store.parcelOverlay && <ContextBar send={(c) => client.send(c)} />}
          <Toasts />
          <ConfirmPopup />
          <Sheets send={(c) => client.send(c)} />
          {store.site && <Minimap renderer={renderer} site={store.site} owner={store.owner} />}
          <CrashPanel onMenu={() => {
            useGameStore.getState().setCrash(null);
            useGameStore.getState().setError(null);
            useGameStore.getState().setPauseOpen(false);
            useGameStore.getState().setScreen('menu');
            client.setSpeed(0);
          }} />
          {store.error && !store.crash && (
            <div role="alert" style="position:absolute;top:46px;left:50%;transform:translateX(-50%);padding:6px 12px;background:#4a1515;border:1px solid #a33;border-radius:10px;z-index:60">
              {t('error.title')}: {store.error}
            </div>
          )}
          <PauseMenu
            saved={savedFlash}
            onResume={resume}
            onSave={() => requestSave(false, false)}
            onExport={() => requestSave(false, true)}
            onExit={() => {
              if (autosave) requestSave(true, false);
              useGameStore.getState().setPauseOpen(false);
              useGameStore.getState().setScreen('menu');
              client.setSpeed(0);
            }}
          />
        </>
      )}
      {!inGame && (
        <Menu
          error={menuError}
          autosave={autosave}
          onAutosave={(on) => {
            setAutosave(on);
            try {
              localStorage.setItem(AUTOSAVE_KEY, on ? '1' : '0');
            } catch {
              // Private mode: the setting just does not persist.
            }
          }}
          onStart={(seed, preset) => startGame(seed, preset)}
          onLoad={(id) => void loadFrom(() => loadSave(id))}
          onImport={(file) => void loadFrom(() => importFromFile(file))}
        />
      )}
    </div>
  );
}

