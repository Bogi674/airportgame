import { AIRFIELD } from '@data/index';
import { APPROACHES, CODES, STAND_TYPES, SURFACES, type CodeLetter, type Surface } from '@shared/airfield';
import type { Command } from '@sim/commands';
import { formatMoney } from './format';
import { FIXTURE_KEYS } from '@shared/business';
import { useToolStore, type TerminalSub } from './stores/toolStore';
import { Icon } from './icons';
import { noticeText, t, tDynamic, tFormat } from './strings';

interface Props {
  send(cmd: Command): void;
}

function Select<T extends string | number>({ label, value, options, onChange, testId }: { label: string; value: T; options: { v: T; text: string }[]; onChange(v: T): void; testId?: string }) {
  return (
    <label style="display:flex;flex-direction:column;font-size:11px;gap:2px">
      {label}
      <select
        data-testid={testId}
        value={String(value)}
        onChange={(e) => {
          const raw = (e.target as HTMLSelectElement).value;
          const opt = options.find((o) => String(o.v) === raw);
          if (opt) onChange(opt.v);
        }}
      >
        {options.map((o) => (
          <option key={String(o.v)} value={String(o.v)}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );
}

function Num({ label, value, min, max, onChange, testId }: { label: string; value: number; min: number; max: number; onChange(v: number): void; testId?: string }) {
  return (
    <label style="display:flex;flex-direction:column;font-size:11px;gap:2px">
      {label}
      <input
        data-testid={testId}
        type="number"
        min={min}
        max={max}
        value={value}
        style="width:56px"
        onInput={(e) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, Math.round(v))));
        }}
      />
    </label>
  );
}

/** Bottom bar: options of the active tool, the hint, and the reason a preview is invalid. */
export function ContextBar({ send }: Props) {
  const s = useToolStore();
  if (s.tool === 'select' && !s.hint) return null;
  const paved = (surface: Surface): boolean => surface === 'asphalt' || surface === 'concrete';
  const tiers = AIRFIELD.surfaces[s.surface].pcrTiers;
  const showPavement = s.tool !== 'select' && s.tool !== 'demolish' && s.tool !== 'stands' && s.tool !== 'gaBlock' && s.tool !== 'terminal';
  const showCode = showPavement && s.tool !== 'apron';
  const problemText = s.problem ? noticeText(s.problem.code, Object.fromEntries(Object.entries(s.problem.args ?? {}).map(([k, v]) => [k, String(v)]))) : null;
  const problemBlock = problemText ? (
    <div data-testid="problem" role="status" style="color:var(--bad);font-size:12px;display:flex;gap:8px;align-items:center">
      <span>{problemText}</span>
      {s.problem?.code === 'notOwned' && s.buy && s.buy.ids.length > 0 && (
        <button data-testid="buy-land" onClick={() => send({ type: 'buyParcels', ids: s.buy?.ids ?? [] })}>
          {tFormat('buy.land', { n: s.buy.ids.length, cost: formatMoney(s.buy.cost) })}
        </button>
      )}
    </div>
  ) : null;
  if (!s.barOpen) {
    return problemBlock ? (
      <div class="panel" style="position:absolute;left:50%;bottom:12px;transform:translateX(-50%);padding:6px 12px">
        {problemBlock}
      </div>
    ) : null;
  }
  return (
    <div
      data-testid="context-bar"
      style="position:absolute;left:50%;bottom:12px;transform:translateX(-50%);max-width:760px;padding:8px 12px;background:var(--panel);border:1px solid var(--line);border-radius:10px;display:flex;flex-direction:column;gap:6px"
    >
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <strong style="align-self:center">{tDynamic(`tool.${s.tool}`)}</strong>
        {s.tool === 'runway' && (
          <Select label={t('opt.mode')} value={s.runwayMode} testId="opt-runway-mode" options={(['new', 'extend', 'shorten'] as const).map((m) => ({ v: m, text: tDynamic(`mode.${m}`) }))} onChange={(v) => s.set({ runwayMode: v, hint: null, problem: null })} />
        )}
        {(s.tool === 'taxiway' || s.tool === 'taxilane') && (
          <Select label={t('opt.mode')} value={s.taxiMode} testId="opt-taxi-mode" options={(['new', 'extend', 'trim', 'cut'] as const).map((m) => ({ v: m, text: tDynamic(`mode.${m}`) }))} onChange={(v) => s.set({ taxiMode: v, hint: null, problem: null })} />
        )}
        {showCode && <Select label={t('opt.code')} value={s.code} testId="opt-code" options={CODES.map((c) => ({ v: c, text: c }))} onChange={(v: CodeLetter) => s.set({ code: v })} />}
        {showPavement && (
          <Select
            label={t('opt.surface')}
            value={s.surface}
            testId="opt-surface"
            options={SURFACES.map((x) => ({ v: x, text: tDynamic(`surface.${x}`) }))}
            onChange={(v: Surface) => s.set({ surface: v, tier: 0, approach: s.tool === 'runway' && !paved(v) ? 'visual' : s.approach })}
          />
        )}
        {showPavement && tiers.length > 1 && (
          <Select label={t('opt.tier')} value={Math.min(s.tier, tiers.length - 1)} options={tiers.map((pcr, i) => ({ v: i, text: tFormat('opt.pcr', { n: pcr }) }))} onChange={(v) => s.set({ tier: v })} />
        )}
        {s.tool === 'runway' && (
          <Select
            label={t('opt.approach')}
            value={s.approach}
            testId="opt-approach"
            options={APPROACHES.filter((a) => a === 'visual' || paved(s.surface)).map((a) => ({ v: a, text: tDynamic(`approach.${a}`) }))}
            onChange={(v) => s.set({ approach: v })}
          />
        )}
        {s.tool === 'rapidExit' && (
          <Select label={t('opt.angle')} value={s.exitAngle} options={[30, 45, 90].map((a) => ({ v: a, text: `${a}°` }))} onChange={(v) => s.set({ exitAngle: v as 30 | 45 | 90 })} />
        )}
        {s.tool === 'parallel' && <Num label={t('opt.connectors')} value={s.connectors} min={1} max={12} onChange={(v) => s.set({ connectors: v })} />}
        {s.tool === 'stands' && (
          <>
            <Select label={t('opt.standType')} value={s.standType} testId="opt-standType" options={STAND_TYPES.filter((x) => x !== 'gaTieDown').map((x) => ({ v: x, text: tDynamic(`standType.${x}`) }))} onChange={(v) => s.set({ standType: v })} />
            <Select label={t('opt.code')} value={s.standCode} options={CODES.map((c) => ({ v: c, text: c }))} onChange={(v: CodeLetter) => s.set({ standCode: v })} />
            <Num label={t('opt.standCount')} value={s.standCount} min={1} max={30} onChange={(v) => s.set({ standCount: v })} />
          </>
        )}
        {s.tool === 'terminal' && (
          <>
            {(['foundation', 'floor', 'wall', 'door', 'zone', 'fixture', 'erase'] as TerminalSub[]).map((sub) => (
              <button key={sub} data-testid={`tsub-${sub}`} aria-pressed={s.tSub === sub} title={tDynamic(`terminal.sub.${sub}`)} onClick={() => s.set({ tSub: sub, hint: `hint.terminal.${sub}`, problem: null, buy: null })} style="display:inline-flex;align-items:center;gap:6px">
                <Icon name={sub} size={15} />
                {tDynamic(`terminal.sub.${sub}`)}
              </button>
            ))}
            {s.tSub === 'floor' && (
              <Select label={t('opt.floorType')} value={s.floorType} options={[1, 2, 3].map((f) => ({ v: f, text: tDynamic(`terminal.floor.${f}`) }))} onChange={(v) => s.set({ floorType: v as 1 | 2 | 3 })} />
            )}
            {s.tSub === 'zone' && (
              <Select label={t('opt.zone')} value={s.zoneType} testId="opt-zone" options={[1, 2, 3, 4].map((z) => ({ v: z, text: tDynamic(`zone.${z}`) }))} onChange={(v) => s.set({ zoneType: v as 1 | 2 | 3 | 4 })} />
            )}
            {s.tSub === 'wall' && (
              <Select label={t('opt.wallType')} value={s.wallType} options={[1, 2].map((f) => ({ v: f, text: tDynamic(`terminal.wall.${f}`) }))} onChange={(v) => s.set({ wallType: v as 1 | 2 })} />
            )}
            {s.tSub === 'fixture' && (
              <Select
                label={t('opt.fixture')}
                value={s.fixtureId}
                testId="opt-fixture"
                options={FIXTURE_KEYS.map((_, i) => ({ v: i + 1, text: tDynamic(`fixture.${i + 1}`) }))}
                onChange={(v) => s.set({ fixtureId: v })}
              />
            )}
          </>
        )}
        {s.tool === 'gaBlock' && <Num label={t('opt.standCount')} value={s.gaCount} min={1} max={20} onChange={(v) => s.set({ gaCount: v })} />}
      </div>
      {s.hint && <div style="color:var(--muted);font-size:12px">{tDynamic(s.hint)}</div>}
      {problemBlock}
    </div>
  );
}
