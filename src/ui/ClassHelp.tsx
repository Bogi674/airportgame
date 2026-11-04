import { AIRCRAFT } from '@data/aircraft';
import { AIRFIELD } from '@data/index';
import { CODES } from '@shared/airfield';
import { t, tFormat } from './strings';

const SPAN: Record<string, string> = { A: '< 15', B: '15 to 24', C: '24 to 36', D: '36 to 52', E: '52 to 65', F: '65 to 80' };

/** Plain explanation of the class letters: the biggest aircraft each one is built for, with the pavement it needs. */
export function ClassHelp() {
  return (
    <details class="classhelp" data-testid="class-help">
      <summary>{t('classes.title')}</summary>
      <div style="font-size:11px;line-height:1.5;color:var(--muted);margin:4px 0">{t('classes.intro')}</div>
      <div style="display:grid;gap:5px">
        {CODES.map((c) => {
          const row = AIRFIELD.codes[c];
          const names = AIRCRAFT.filter((a) => a.derivedForReading.code === c)
            .slice(0, 4)
            .map((a) => a.name)
            .join(', ');
          return (
            <div key={c} style="font-size:11px">
              <b>{c}</b>
              {' '}
              {tFormat('classes.row', { span: SPAN[c], rw: row.runwayWidthM, tw: row.taxiwayWidthM, r: row.filletRadiusM })}
              {names && <div style="color:var(--muted)">{names}</div>}
            </div>
          );
        })}
      </div>
    </details>
  );
}
