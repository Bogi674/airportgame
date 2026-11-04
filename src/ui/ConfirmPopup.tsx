import { useToolStore } from './stores/toolStore';
import { toolActions } from './tools/actions';
import { t } from './strings';

/** Appears at the pointer after a right click while laying something out: build it or drop it. */
export function ConfirmPopup() {
  const at = useToolStore((s) => s.confirmAt);
  if (!at) return null;
  return (
    <div data-testid="confirm-popup" role="dialog" class="panel" style={`position:absolute;left:${Math.max(8, at.x - 90)}px;top:${at.y + 14}px;z-index:40;padding:8px;display:flex;gap:8px`}>
      <button data-testid="confirm-build" aria-pressed="true" onClick={() => toolActions.confirm()}>
        {t('confirm.build')} <span class="kbd">Enter</span>
      </button>
      <button data-testid="confirm-cancel" onClick={() => toolActions.cancel()}>
        {t('confirm.cancel')} <span class="kbd">Esc</span>
      </button>
    </div>
  );
}
