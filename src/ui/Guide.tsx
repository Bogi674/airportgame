import { useGameStore } from './stores/gameStore';
import { t, type StringKey } from './strings';

/** Short guided start: the five steps that get the first flight landing. Steps tick themselves off. */
export function Guide() {
  const af = useGameStore((s) => s.airfield);
  const b = useGameStore((s) => s.business);
  const hidden = useGameStore((s) => s.guideHidden);
  const hide = useGameStore((s) => s.setGuideHidden);
  if (hidden) return null;
  const terminalReady = !!b && b.depCapacity > 0 && b.arrCapacity > 0;
  const steps: { key: StringKey; done: boolean }[] = [
    { key: 'guide.runway', done: af.runways.length > 0 },
    { key: 'guide.taxiway', done: af.taxiways.length > 0 },
    { key: 'guide.stand', done: af.stands.length > 0 },
    { key: 'guide.terminal', done: terminalReady },
    { key: 'guide.airline', done: !!b && b.airlines.some((a) => a.rotations > 0) },
  ];
  const all = steps.every((s) => s.done);
  return (
    <div data-testid="guide" style="position:absolute;left:62px;top:52px;width:260px;padding:8px 10px;background:#10161cf2;border:1px solid #2c3a45;border-radius:6px;font-size:12px;line-height:1.6">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>{t('guide.title')}</strong>
        <button style="padding:0 6px" onClick={() => hide(true)}>
          {t('guide.hide')}
        </button>
      </div>
      {steps.map((s) => (
        <div key={s.key} style={s.done ? 'color:#a8e6a1' : ''}>
          {s.done ? '✓' : '○'} {t(s.key)}
        </div>
      ))}
      {all && <div style="color:#a8e6a1">{t('guide.done')}</div>}
    </div>
  );
}
