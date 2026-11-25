import type { ComponentChildren, CSSProperties } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon, type IconName } from '../icons';
import { clockAngles } from './clock';
import './kit.css';

/** Category group of revision 6 section 3.1: it colors title bars, rail icons and flyouts. */
export type Group = 'air' | 'trm' | 'ops' | 'tool' | 'bad';

/** White window with the solid lip of revision 6 section 3.3. `win` gives the modal radius. */
export function Panel(props: { children: ComponentChildren; win?: boolean; class?: string; style?: CSSProperties | string; testid?: string; role?: 'dialog' | 'region' | 'complementary'; label?: string }) {
  return (
    <div class={`pn${props.win ? ' win' : ''}${props.class ? ` ${props.class}` : ''}`} style={props.style} data-testid={props.testid} role={props.role} aria-label={props.label}>
      {props.children}
    </div>
  );
}

/** Title bar in a group gradient with an icon chip, an optional tag and a close button. */
export function TitleBar(props: { group: Group; icon?: IconName; title: ComponentChildren; tag?: string; onClose?: () => void; closeLabel?: string }) {
  return (
    <div class={`tbar g-${props.group}`}>
      {props.icon && (
        <span class="tbar-ic">
          <Icon name={props.icon} size={15} />
        </span>
      )}
      {props.tag && <span class="tbar-tag">{props.tag}</span>}
      <span class="tbar-t">{props.title}</span>
      {props.onClose && (
        <button class="xb" aria-label={props.closeLabel ?? 'Close'} title={props.closeLabel} onClick={props.onClose}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

/** Chunky pressable button: primary (accent), secondary (white) or danger (red). */
export function Button(props: {
  kind?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  children?: ComponentChildren;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  testid?: string;
  class?: string;
  style?: CSSProperties | string;
}) {
  const kind = props.kind === 'danger' ? 'br' : props.kind === 'secondary' ? 'bw' : 'bb';
  const size = props.size === 'sm' ? ' sm' : props.size === 'lg' ? ' lg' : '';
  return (
    <button class={`btn ${kind}${size}${props.class ? ` ${props.class}` : ''}`} style={props.style} onClick={props.onClick} disabled={props.disabled} title={props.title} data-testid={props.testid}>
      {props.icon && <Icon name={props.icon} size={15} />}
      {props.children}
    </button>
  );
}

/** Segmented control: the picked option is a mini primary button. */
export function Segmented<T extends string | number>(props: { options: readonly { value: T; label: ComponentChildren; title?: string; disabled?: boolean }[]; value: T; onChange: (v: T) => void; label?: string; testid?: string }) {
  return (
    <div class="seg" role="group" aria-label={props.label} data-testid={props.testid}>
      {props.options.map((o) => (
        <button key={String(o.value)} class="sg" aria-pressed={o.value === props.value} title={o.title} disabled={o.disabled} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** On and off switch, 36 by 20. */
export function Switch(props: { on: boolean; onChange?: (on: boolean) => void; label: string; disabled?: boolean; testid?: string }) {
  return (
    <button class="sw" role="switch" aria-checked={props.on} aria-label={props.label} title={props.label} disabled={props.disabled} data-testid={props.testid} onClick={() => props.onChange?.(!props.on)}>
      <span />
    </button>
  );
}

/** Counter pill: an icon and a bold value. With `onClick` it is a button, `open` marks its dropdown as open. */
export function Pill(props: { icon?: ComponentChildren; children: ComponentChildren; onClick?: () => void; open?: boolean; title?: string; testid?: string; chevron?: boolean }) {
  const body = (
    <>
      {props.icon}
      {props.children}
      {props.chevron && <Chevron down />}
    </>
  );
  if (!props.onClick) return <span class="pill" title={props.title} data-testid={props.testid}>{body}</span>;
  return (
    <button class="pill" aria-expanded={props.open ?? false} title={props.title} data-testid={props.testid} onClick={props.onClick}>
      {body}
    </button>
  );
}

/** Small chevron glyph, right when closed and down when open. */
export function Chevron({ down }: { down?: boolean }) {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={down ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
    </svg>
  );
}

/** Stat pair: a 9 px label above a 12 px value with an optional unit. */
export function Stat(props: { label: ComponentChildren; value: ComponentChildren; unit?: string; tone?: 'good' | 'bad'; testid?: string }) {
  return (
    <div class={`pv${props.tone ? ` ${props.tone}` : ''}`} data-testid={props.testid}>
      <span class="lbl">{props.label}</span>
      <b>
        {props.value}
        {props.unit && <small>{props.unit}</small>}
      </b>
    </div>
  );
}

/** Thumbnail placeholder of revision 6 section 3.5: a picture glyph on a pale slot. */
export function Thumb({ w, h }: { w: number | string; h: number }) {
  return (
    <div class="thumb-ph" style={{ width: typeof w === 'number' ? `${w}px` : w, height: `${h}px` }} aria-hidden="true">
      <svg width={Math.min(22, h * 0.55)} height={Math.min(22, h * 0.55)} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="1.8" />
        <path d="M3 18l6-6 4 4 3-3 5 5" />
      </svg>
    </div>
  );
}

/** LED board: navy dot grid with lit text. Each line is a list of words, `lit` words glow blue. */
export function LedBoard(props: { lines: readonly (readonly { text: string; lit?: boolean }[])[]; size: number; width?: number; height?: number; chip?: boolean }) {
  return (
    <div class={`led${props.chip ? ' led-chip' : ''}`} style={{ fontSize: `${props.size}px`, width: props.width ? `${props.width}px` : undefined, height: props.height ? `${props.height}px` : undefined }}>
      {props.lines.map((line, i) => (
        <div key={i} style="white-space: nowrap; line-height: 1.05">
          {line.map((w, j) => (
            <span key={j} class={w.lit ? 'lit' : undefined}>
              {j > 0 ? ' ' : ''}
              {w.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Analog clock driven by game time: blue bezel, white face, 12 ticks, navy hands and a blue second hand. */
export function Clock({ seconds, size, still, minuteStep }: { seconds: number; size: number; still?: boolean; minuteStep?: boolean }) {
  const a = clockAngles(seconds, minuteStep || still);
  const ticks = [];
  for (let i = 0; i < 12; i++) ticks.push(<path key={i} d="M12 2.6v1.6" transform={`rotate(${i * 30} 12 12)`} stroke="#9AB4DA" stroke-width={i % 3 === 0 ? 1.4 : 0.9} stroke-linecap="round" />);
  return (
    <svg class="clock" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="var(--accent)" />
      <circle cx="12" cy="12" r="9" fill="#fff" />
      {ticks}
      <path d="M12 12V7" transform={`rotate(${a.hour} 12 12)`} stroke="#0F2240" stroke-width="1.8" stroke-linecap="round" />
      <path d="M12 12V4.6" transform={`rotate(${a.minute} 12 12)`} stroke="#0F2240" stroke-width="1.3" stroke-linecap="round" />
      {!still && !minuteStep && <path d="M12 13.5V4" transform={`rotate(${a.second} 12 12)`} stroke="var(--accent)" stroke-width="0.7" stroke-linecap="round" />}
      <circle cx="12" cy="12" r="1.1" fill="#0F2240" />
    </svg>
  );
}

/**
 * Popover panel under its trigger (revision 6 section 5.8). It closes on Escape and on a click outside both
 * itself and the element marked with `data-pop-anchor` equal to its id.
 */
export function Popover(props: { id: string; onClose: () => void; children: ComponentChildren; style?: CSSProperties; testid?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose, id } = props;
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const down = (e: PointerEvent): void => {
      const el = e.target as Element | null;
      if (!el || ref.current?.contains(el) || el.closest(`[data-pop-anchor="${id}"]`)) return;
      onClose();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down, true);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', down, true);
    };
  }, [onClose, id]);
  return (
    <div ref={ref} class="pn pop" style={props.style} data-testid={props.testid} role="dialog" aria-label={props.label}>
      {props.children}
    </div>
  );
}
