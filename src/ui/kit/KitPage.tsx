import { useState } from 'preact/hooks';
import { Button, Clock, LedBoard, Panel, Pill, Popover, Segmented, Stat, Switch, Thumb, TitleBar, type Group } from './index';

const GROUPS: readonly Group[] = ['air', 'trm', 'ops', 'tool', 'bad'];

/** Test page of the revision 6 primitives in every state, opened with `?kit` (task R6-02). Developer only, never linked from the game. */
export function KitPage() {
  const [seg, setSeg] = useState(1);
  const [sw, setSw] = useState(true);
  const [pop, setPop] = useState(false);
  return (
    <div style="padding:24px;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;overflow:auto;height:100%;box-sizing:border-box" data-testid="kit">
      <Panel style="width:300px">
        {GROUPS.map((g) => (
          <TitleBar key={g} group={g} icon="runway" title={`Title bar ${g}`} tag={g === 'bad' ? 'AREA' : undefined} onClose={() => undefined} />
        ))}
      </Panel>
      <Panel style="width:300px;padding:12px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <Button icon="play">Primary</Button>
          <Button kind="secondary">Secondary</Button>
          <Button kind="danger" icon="demolish">Danger</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" kind="secondary">Small</Button>
          <Button size="lg">Large</Button>
        </div>
        <Segmented options={[0, 90, 180, 270].map((v) => ({ value: v, label: `${v}°` }))} value={seg * 90} onChange={(v) => setSeg(v / 90)} label="Rotation" />
        <div style="display:flex;gap:10px;align-items:center">
          <Switch on={sw} onChange={setSw} label="Snapping" />
          <Switch on={false} label="Off" />
          <Switch on label="Locked" disabled />
        </div>
        <div style="display:flex;gap:8px;position:relative">
          <Pill>$12.30M</Pill>
          <span data-pop-anchor="kit">
            <Pill chevron open={pop} onClick={() => setPop(!pop)}>9</Pill>
          </span>
          {pop && (
            <Popover id="kit" onClose={() => setPop(false)} style={{ top: '42px', left: '0px', width: '200px' }}>
              Popover body
            </Popover>
          )}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
          <Stat label="Length" value="3,200" unit="m" />
          <Stat label="Refund" value="+$58.2K" tone="good" />
          <Stat label="Cost" value="$4.1K" tone="bad" />
        </div>
        <Thumb w="100%" h={40} />
      </Panel>
      <Panel style="padding:12px;display:flex;flex-direction:column;gap:12px">
        <LedBoard size={30} width={300} lines={[[{ text: 'AIRFIELD', lit: true }], [{ text: 'TYCOON' }]]} />
        <div style="display:flex;gap:12px;align-items:center">
          <LedBoard chip size={11} lines={[[{ text: '09L', lit: true }]]} />
          <Clock seconds={9 * 3600 + 5 * 60 + 30} size={26} />
          <Clock seconds={21 * 3600 + 5 * 60} size={52} still />
          <Clock seconds={14 * 3600 + 42 * 60 + 10} size={64} />
        </div>
      </Panel>
    </div>
  );
}
