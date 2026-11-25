import { useEffect, useRef } from 'preact/hooks';
import type { Command } from '@sim/commands';
import { accessSnapshot, lostAccess, type AccessSnapshot } from './accessWatch';
import { Coin } from './BuildMenu';
import { formatMoney } from './format';
import { Icon } from './icons';
import { Button, Panel, TitleBar } from './kit';
import { useDemolishStore } from './stores/demolishStore';
import { useGameStore } from './stores/gameStore';
import { t, tFormat } from './strings';

/**
 * The confirm window of every demolish act (owner, 2026-11-25): what goes, the refund, Demolish (Enter) and Cancel (Esc).
 * After the act it compares item access before and after, and every stand or bay that lost its taxiway or road raises
 * an alert asking the player to connect it again.
 */
export function DemolishConfirm({ send }: { send(cmd: Command): void }) {
  const pending = useDemolishStore((s) => s.pending);
  const cancel = useDemolishStore((s) => s.cancel);
  const airfield = useGameStore((s) => s.airfield);
  const watch = useRef<{ before: AccessSnapshot; version: number } | null>(null);

  useEffect(() => {
    const w = watch.current;
    if (!w || airfield.version === w.version) return;
    watch.current = null;
    const g = useGameStore.getState();
    for (const lost of lostAccess(w.before, accessSnapshot(airfield), airfield)) {
      const text = tFormat(`alert.lostAccess.${lost.kind}` as 'alert.lostAccess.taxiway', { name: lost.name });
      g.pushAlert(text, 'warn');
      g.logAlert(text, 'warning', g.tick, lost.kind === 'bay' ? null : lost.name);
    }
  }, [airfield]);

  const confirm = (): void => {
    const p = useDemolishStore.getState().pending;
    if (!p) return;
    const af = useGameStore.getState().airfield;
    watch.current = { before: accessSnapshot(af), version: af.version };
    for (const c of p.commands) send(c);
    cancel();
    p.after?.();
  };

  useEffect(() => {
    if (!pending) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        confirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      }
    };
    // Capture phase, ahead of the tool controller and the app keys, so Enter and Escape act on this window only.
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [pending]);

  if (!pending) return null;
  return (
    <div class="modal-scrim" data-testid="demolish-confirm-scrim" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
      <Panel win role="dialog" label={t('demolish.title')} testid="demolish-confirm" style="width:340px;max-width:calc(100vw - 32px)">
        <TitleBar group="bad" icon="bulldoze" title={t('demolish.title')} onClose={cancel} closeLabel={t('confirm.cancel')} />
        <div style="padding:14px;display:flex;flex-direction:column;gap:10px">
          <div style="font:700 var(--fs-lg) var(--font-ui);overflow-wrap:anywhere" data-testid="demolish-what">
            {pending.what}
          </div>
          {pending.lines && pending.lines.length > 0 && (
            <div style="display:flex;flex-direction:column;gap:3px;font-size:var(--fs-sm);color:var(--ink-2)">
              {pending.lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
          <div class="well" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span class="cap">{t('demolish.refund')}</span>
            {pending.refund > 0 ? (
              <b data-testid="demolish-refund" style="display:inline-flex;align-items:center;gap:5px;font:800 var(--fs-xl) var(--font-ui);color:var(--good-text);font-variant-numeric:tabular-nums">
                <Coin size={14} />+{formatMoney(pending.refund)}
              </b>
            ) : (
              <b data-testid="demolish-refund" style="font:700 var(--fs-md) var(--font-ui);color:var(--ink-2)">
                {t('demolish.noRefund')}
              </b>
            )}
          </div>
          <div style="font-size:var(--fs-xs);color:var(--ink-2);display:flex;gap:6px;align-items:flex-start">
            <span style="color:var(--warn-text);flex:none">
              <Icon name="warning" size={13} />
            </span>
            {t('demolish.note')}
          </div>
          <div style="display:flex;gap:8px;margin-top:4px">
            <Button kind="danger" testid="demolish-yes" style="flex:1" onClick={confirm}>
              {t('demolish.yes')} <span class="kbd">Enter</span>
            </Button>
            <Button kind="secondary" testid="demolish-no" onClick={cancel}>
              {t('confirm.cancel')} <span class="kbd">Esc</span>
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
