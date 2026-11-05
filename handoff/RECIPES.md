# RECIPES.md

Step by step patterns taken from code that already works. Follow the matching recipe and name it in your plan.

## R1. Add a player command

1. **Type** in `src/sim/commands.ts`, in the `Command` union, with a doc comment:
   ```ts
   /** Builds or removes a turn pad at one end of a runway on the given side, or removes it with null. */
   | { type: 'turnPad'; runwayId: number; end: 'a' | 'b'; side: PadSide | null }
   ```
2. **Dispatch**. Airfield commands go in the switch of `Airfield.execute` (`src/sim/airfield/airfield.ts`):
   ```ts
   case 'turnPad':
     return this.turnPad(cmd, ctx, cash, env);
   ```
   Business commands go in `Sim.apply` (`src/sim/sim.ts`) and return a problem string or null.
3. **Handler** returns `{ cashDelta }` on success (negative when spending) or a `Problem` `{ code, args }`. Check in this order: the object exists, the rules, the land (`checkPolygon`, `checkStrip` from `src/shared/validate.ts`), the money. Only then change state, then call `this.refresh()` if the airfield shape changed.
4. **Undo**: additions go through `this.place(items, cash)` or `this.record(...)`. In place edits push an `Op` with `swaps` (see `moveHolding`).
5. **Hash**: if the command adds saved state, fold it into `Airfield.hash` (or the owner's `hash`).
6. **Problem text**: add `"notice.<code>": "..."` to `src/ui/strings/en.json` for every new problem code.
7. **Test** with `run`, which enqueues, steps one tick and returns the events:
   ```ts
   const sim = ownedSim();
   run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2000, code: 'C', approach: 'visual', surface: 'asphalt', tier: 2 });
   expect(run(sim, { type: 'turnPad', runwayId: 1, end: 'a', side: 'left' })).toEqual([]);
   expect(run(sim, { type: 'turnPad', runwayId: 1, end: 'a', side: 'left' })).toEqual(['padExists']);
   ```

## R2. Add data values

1. Add the keys to the JSON file with a `note` string explaining units and source.
2. Add the same keys to the strict zod schema in `src/data/schemas/<file>.ts`. Reuse `perCode` and `perApproach` where they fit.
3. Read them through the parsed export from `@data/index` (`AIRFIELD.turnPad.widthM[code]`), never by importing the JSON directly.
4. If a value has a rule (positive, larger than another), add a `.refine` or `.superRefine` with a clear message, and a case in `tests/data.test.ts`.

## R3. Change the save shape

1. Bump `SAVE_VERSION` in `src/sim/save/migrations.ts`.
2. Add a step in `migrate`:
   ```ts
   // Version 7 to 8: terminals gained gate desks. Older saves have none.
   if (save.version < 8) save.version = 8;
   ```
   If old saves need converting (a renamed field, a new required field), convert them in that step, like version 3 to 4 does for stands.
3. Make `loadState` tolerate the old shape (`?? default`).
4. Add a test in `tests/save.test.ts` that loads a version 7 object and checks the defaults.
5. Optional new fields on objects that are already saved still need the version bump and a comment, so the history stays readable.

## R4. Derived state that must not rebuild the network

Use when a result depends on the airfield but does not change taxi routes (obstacle results, overlays, statistics).

1. Store it on `airfield.data` (so it reaches the UI) and bump a separate counter, like `Airfield.setObstacles` bumps `obstaclesVersion`.
2. Recompute in `Sim` only when its inputs changed: compare cheap version numbers first, then an input key (see `updateObstacles`).
3. Hand the result to `traffic` directly when traffic needs it.
4. Call the recompute at the end of `Sim.restore`.
5. Include the counter in `takeAirfieldDirty` so the UI receives it.

## R5. Add a new aircraft state or per aircraft value

1. Add the state to `AcState` in `src/sim/ops/traffic.ts` with the next free number.
2. Add a `case` in `Traffic.update`, and update every `switch` or `if` that lists states (`replan`, `onGround`, counting loops). Search for `AcState.Takeoff` to find them.
3. A new per aircraft typed array goes next to the others, and into `Traffic.arrays()` so it is saved and hashed.
4. Runway time is held through `slotFree` and `reserve`. Extend the reservation end when the new state occupies the runway longer.

## R6. Add UI text

1. Pick a key in the existing families: `tool.*`, `opt.*`, `hint.*`, `ghost.*`, `inspector.*`, `notice.*`, `alert.*`, `reason.*`.
2. Add it next to related keys in `src/ui/strings/en.json` by editing that one line region. Do not reformat the file.
3. Read it with `t('key')` or `tFormat('key', { n })`. Placeholders are `{name}`.
4. Text follows the writing style: short sentences, no dashes as connectors, sentence case, numbers with units (`{d} m`).

## R7. Add a build tool

Use the rapid exit tool as the model.

1. Add the tool id to `Tool` in `src/ui/stores/toolStore.ts`, plus any options with defaults.
2. Add a card in `CATEGORIES` in `src/ui/BuildMenu.tsx` (`run` sets the tool, `active` highlights it) and a thumbnail in `src/ui/thumbs.tsx` if the card shows one.
3. Add its options to `src/ui/ContextBar.tsx`.
4. In `src/ui/tools/controller.ts`: a `previewX(p)` called from `move`, a `commitX(p)` called from `up`, and `hint.x` text. The preview builds a `Ghost` (`src/shared/ghost.ts`) with `valid`, shapes and a `label`; `this.show(ghost, problem, hintKey)` displays it and the problem text.
5. Validate in the preview with the same shared functions the sim uses, so the preview never promises what the sim refuses.
6. Add strings (R6) and update `docs/UI_DESIGN.md` section 6 and the controls table in section 7.

## R8. Draw something new on the airfield

1. Static paint (markings, pavement) goes through the plan: compute geometry in `src/shared` or `src/render/markings/taxiPlan.ts`, paint it in `src/render/markings/airfieldPaint.ts`. It is baked into chunks; it updates when the airfield version changes.
2. Dynamic things (aircraft, vehicles, people, previews) are drawn every frame in `src/render/renderer.ts`.
3. Sizes come from data in meters. Lines that must stay visible use `lineM(win, meters, minPx)` in `airfieldPaint.ts`.
4. Check with a screenshot at two zooms: about 0.3 px/m (overview) and about 2 px/m (detail).

## R9. Determinism test for a sim feature

```ts
it('two runs from one seed give identical hashes', () => {
  const a = ownedSim();
  const b = ownedSim();
  for (const s of [a, b]) {
    buildTestAirport(s, { standsPerRow: 4 });
    run(s, /* the command your feature adds */);
    s.enqueue({ type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
    for (let t = 0; t < 2000; t++) s.step();
  }
  expect(a.stateHash()).toBe(b.stateHash());
});
```

Also save mid run, restore into a fresh sim, run both on, and compare hashes when the feature adds saved state (see `tests/sim.test.ts`, the replay tests).

## R10. Visual check

1. `npm run dev` in a second terminal.
2. Copy `handoff/scenarios/example-airport.json` to `handoff/scenarios/<task-id>.json`. Change `commands`, `camera` and `actions`. World coordinates are meters; north is smaller y; headings are compass degrees.
3. `npm run shot -- handoff/scenarios/<task-id>.json shots/<task-id>`.
4. Open the PNGs. Compare with the reference sheet. Write the comparison in the work file.

## R11. Add a terminal fixture

1. Append the key at the end of `FIXTURE_KEYS` in `src/shared/business.ts`. Never insert in the middle; ids are saved.
2. Add its zones to `FIXTURE_ZONES` and its module data (cost, footprint, servers, service time) to `src/data/business.json` and the schema.
3. Teach `terminalOps.ts` its footprint if it is larger than one cell, and `terminalRooms.ts` any room rule.
4. Add a build menu card with `fx(key, thumb)` in `BuildMenu.tsx`.
5. Count it where the business sums fixtures (`summarize` in `terminalOps.ts`).
6. Test placement, the footprint, and the capacity it adds.
