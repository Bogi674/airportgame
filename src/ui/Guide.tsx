import { useGameStore } from './stores/gameStore';
import { t, tDynamic, type StringKey } from './strings';

/** Short guided start: the five steps that get the first flight landing. Steps tick themselves off. */
export function Guide() {
  const af = useGameStore((s) => s.airfield);
  const b = useGameStore((s) => s.business);
  const hidden = useGameStore((s) => s.guideHidden);
  const hide = useGameStore((s) => s.setGuideHidden);
  const sheetOpen = useGameStore((s) => s.sheet !== null);
  // The card sits where the side sheets open, so it steps aside while one is shown.
  if (hidden || sheetOpen) return null;
  const miss = b ? b.readiness : ['noTerminal'];
  const terminalReady = !!b && !miss.some((k) => k !== 'noAtc');
  const steps: { key: StringKey; done: boolean }[] = [
    { key: 'guide.runway', done: af.runways.length > 0 },
    { key: 'guide.taxiway', done: af.taxiways.length > 0 },
    { key: 'guide.stand', done: af.stands.length > 0 },
    { key: 'guide.terminal', done: terminalReady },
    { key: 'guide.atc', done: af.runways.length > 0 && (af.towers?.length ?? 0) > 0 },
    { key: 'guide.airline', done: !!b && b.airlines.some((a) => a.rotations > 0) },
  ];
  const all = steps.every((s) => s.done);
  return (
    <div data-testid="guide" style="position:absolute;left:80px;top:72px;width:260px;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;font-size:12px;line-height:1.6">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>{t('guide.title')}</strong>
        <button style="padding:0 6px" onClick={() => hide(true)}>
          {t('guide.hide')}
        </button>
      </div>
      {steps.map((s) => (
        <div key={s.key} style={s.done ? 'color:var(--ok)' : ''}>
          {s.done ? '✓' : '○'} {t(s.key)}
          {!s.done && s.key === 'guide.terminal' && miss.filter((k) => k !== 'noAtc').map((k) => <div key={k} style="color:var(--muted);padding-left:16px">{tDynamic(`ready.${k}`)}</div>)}
          {!s.done && s.key === 'guide.atc' && miss.filter((k) => k === 'noAtc').map((k) => <div key={k} style="color:var(--muted);padding-left:16px">{tDynamic(`ready.${k}`)}</div>)}
        </div>
      ))}
      {all && <div style="color:var(--ok)">{t('guide.done')}</div>}
    </div>
  );
}
