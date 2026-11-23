import { tDynamic } from './strings';

/** Text of an event choice: the event's own wording when it has one, else the shared wording of the choice id (T50). */
export function choiceText(event: string, choice: string): string {
  const own = `event.${event}.${choice}`;
  const text = tDynamic(own);
  return text === own ? tDynamic(`event.choice.${choice}`) : text;
}
