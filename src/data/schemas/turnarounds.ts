import { z } from 'zod';

const task = z.strictObject({
  id: z.string().min(1),
  /** Vehicle kind id from `gse.json` that must be docked while the task runs, or null for a task done by hand. */
  kind: z.string().min(1).nullable(),
  /** Part of the role turnaround the task takes. */
  share: z.number().positive().max(1),
  /** Ids of tasks listed earlier that must be done first. */
  after: z.array(z.string().min(1)),
});

/** Turnaround task list of airline flights (`src/data/turnarounds.json`, T63). */
export const turnaroundsSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  /** Weight of one turnaround in the running cleanliness and ground handling scores of the rating. */
  ratingWeight: z.number().positive().max(1),
  tasks: z.array(task).min(1).max(16),
});

export type TurnaroundsData = z.infer<typeof turnaroundsSchema>;
