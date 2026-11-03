import { useCallback, useEffect, useMemo } from 'preact/hooks';
import type { Renderer } from '@render/renderer';
import { SPEEDS, type Speed } from '@shared/time';
import { SimClient } from '../worker/client';
import { MapView } from './MapView';
import { useGameStore } from './stores/gameStore';
import { t } from './strings';

const SEED = 'GOLDEN-0001';

export function App() {
  const store = useGameStore();
  const client = useMemo(
    () =>
      new SimClient({
        onPerf: (report) => useGameStore.getState().setPerf(report, client.tick),
        onError: (message) => useGameStore.getState().setError(message),
      }),
    [],
  );

  useEffect(() => {
    client.init(SEED, { preset: 'flatCoastal' });
    return () => client.dispose();
  }, [client]);

  const onRenderer = useCallback((renderer: Renderer | null) => {
    (window as unknown as { __renderer?: Renderer | null }).__renderer = renderer;
  }, []);

  const setSpeed = (s: Speed): void => {
    store.setSpeed(s);
    client.setSpeed(s);
  };

  const spawn = (): void => {
    for (let i = 0; i < 50; i++) {
      client.send({
        type: 'spawnTestAircraft',
        x: 500 + ((i * 137) % 7000),
        y: 500 + ((i * 251) % 7000),
        heading: (i * 0.61) % 6.28,
        speed: 70,
      });
    }
  };

  return (
    <div style="position:relative;width:100%;height:100%;font:13px system-ui,sans-serif;color:#dfe7ec">
      <MapView client={client} onRenderer={onRenderer} />
      <div
        data-testid="hud"
        style="position:absolute;top:8px;left:8px;padding:8px 10px;background:#10161ccc;border:1px solid #2c3a45;border-radius:6px"
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
          <button data-testid="spawn" onClick={spawn}>
            {t('hud.spawn')}
          </button>
          <button onClick={() => client.send({ type: 'clearTestAircraft' })}>{t('hud.clear')}</button>
        </div>
        {store.error && (
          <div role="alert" style="margin-top:6px;color:#ff8f8f">
            {t('error.title')}: {store.error}
          </div>
        )}
      </div>
    </div>
  );
}
