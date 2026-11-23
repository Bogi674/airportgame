import { z } from 'zod';

/** Event preconditions: what the airport must have for the event to be drawn and to fire (T50). */
export const EVENT_REQUIRES = ['fuelFarm', 'vehicle', 'airline', 'diversionType', 'staff'] as const;
export type EventRequire = (typeof EVENT_REQUIRES)[number];

const share = z.number().min(0).max(1);
const positiveInt = z.number().int().positive();
const nonnegative = z.number().nonnegative();

/** One consequence of a choice. Minutes are game minutes from the moment the choice is made. */
const effect = z.discriminatedUnion('kind', [
  /** The weather of the event acts at this share of its full strength until it clears. */
  z.strictObject({ kind: z.literal('weatherSeverity'), share }),
  /** Fuel tankers deliver nothing for the minutes; deliveries due meanwhile arrive when it ends. */
  z.strictObject({ kind: z.literal('fuelHold'), minutes: positiveInt }),
  /** The vehicle drawn for the event is out of the fleet for the minutes. */
  z.strictObject({ kind: z.literal('vehicleOut'), minutes: positiveInt }),
  /** The airline drawn for the event gains the points of satisfaction. */
  z.strictObject({ kind: z.literal('airlineSatisfaction'), points: z.number() }),
  /** The type drawn for the event lands, pays the fee instead of landing and parking, and holds a stand for the minutes. */
  z.strictObject({ kind: z.literal('diversion'), fee: nonnegative, minutes: positiveInt }),
  /** Staff are hired at this share below the need of every role for the minutes. */
  z.strictObject({ kind: z.literal('staffShort'), share, minutes: positiveInt }),
  /** Pays this share of one day of staff wages at once. */
  z.strictObject({ kind: z.literal('wagePremium'), share: nonnegative }),
]);
export type EventEffect = z.infer<typeof effect>;

const choice = z.strictObject({ id: z.string().min(1), cost: nonnegative, effects: z.array(effect) });

const event = z
  .strictObject({
    id: z.string().min(1),
    /** Draw weight of an operational event. A weather event weighs by its climate instead. */
    weight: nonnegative.optional(),
    weather: z.enum(['rain', 'fog', 'wind']).optional(),
    requires: z.array(z.enum(EVENT_REQUIRES)),
    fallback: z.string().min(1),
    choices: z.array(choice).length(2),
  })
  .refine((e) => (e.weight === undefined) !== (e.weather === undefined), 'an event has either a weight or a weather kind')
  .refine((e) => e.choices.some((c) => c.id === e.fallback), 'the fallback must name one of the choices')
  .refine((e) => e.weather !== undefined || e.choices.every((c) => c.effects.every((x) => x.kind !== 'weatherSeverity')), 'only weather events change the weather severity');

export const eventsSchema = z
  .strictObject({
    note: z.string(),
    fireWithinHours: positiveInt,
    choiceHours: positiveInt,
    climateWeight: nonnegative,
    windShare: share,
    weatherHours: z.strictObject({ min: positiveInt, max: positiveInt }),
    diversionLeadMin: positiveInt,
    events: z.array(event).min(1),
  })
  .refine((d) => d.weatherHours.min <= d.weatherHours.max, 'weatherHours.min must not exceed max')
  .refine((d) => d.fireWithinHours + d.choiceHours < 24, 'an event must be decided within its day')
  .refine((d) => new Set(d.events.map((e) => e.id)).size === d.events.length, 'event ids must be unique');
export type EventsData = z.infer<typeof eventsSchema>;
