import type { Command } from '@sim/commands';
import { useGameStore } from './stores/gameStore';
import { formatMoney } from './format';
import { t, tDynamic, tFormat } from './strings';
import { choiceText } from './eventText';

/** The open decision of the event director (T50): title, what happened, two choices with their cost and the time left. */
export function EventCard({ send }: { send: (c: Command) => void }) {
  const ev = useGameStore((s) => s.business?.event ?? null);
  if (!ev) return null;
  return (
    <div data-testid="event-card" role="dialog" aria-label={tDynamic(`event.${ev.id}.title`)} style="padding:8px 10px;background:var(--panel);border:1px solid var(--warn);border-radius:10px;font-size:12px;display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <strong>{tDynamic(`event.${ev.id}.title`)}</strong>
        <span style="color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;font-size:10px">{t('event.card.title')}</span>
      </div>
      <div>{tDynamic(`event.${ev.id}.body`).replace('{subject}', ev.subject)}</div>
      <div style="display:flex;flex-direction:column;gap:4px">
        {ev.choices.map((c) => (
          <button key={c.id} data-testid={`event-choice-${c.id}`} style="display:flex;justify-content:space-between;gap:12px;text-align:left" onClick={() => send({ type: 'eventChoice', seq: ev.seq, choice: c.id })}>
            <span>{choiceText(ev.id, c.id)}</span>
            <span style="color:var(--muted);white-space:nowrap">{c.cost > 0 ? formatMoney(c.cost) : t('event.card.free')}</span>
          </button>
        ))}
      </div>
      <div style="color:var(--muted)">{tFormat('event.card.left', { n: ev.minutesLeft, choice: choiceText(ev.id, ev.fallback).toLowerCase() })}</div>
    </div>
  );
}
