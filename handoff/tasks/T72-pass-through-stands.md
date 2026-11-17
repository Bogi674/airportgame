# T72 Pass through stands

## Goal

The player builds pass through (taxi through) stands in all four sizes. Aircraft enter from the taxiway behind the tail and, when a taxiway lies ahead of the nose, leave forward along a lead out with no push back. The stand paints the taxi through markings of `docs/art/surfaces_stands.png`.

## Read first

`docs/DESIGN_REVISION_4.md` section 2, `docs/DESIGN_REVISION_3.md` section 3 item 9, `handoff/QUESTIONS.md` 2026-11-17 T59 and T72, `src/shared/standFork.ts`, `src/sim/airfield/network.ts`, `src/sim/ops/traffic.ts` (departure start), `src/render/markings/standLayout.ts` and `standPaint.ts`.

## Decisions

* `StandType` gains `through`. No save migration: old stands keep contact or remote.
* Lead out is optional. A through stand with a centerline ahead of its nose within the lead in reach of the slot's nose edge gets a lead out: a straight stem from the stand point to an out fork and two arcs onto that centerline. Without one it departs by push back.
* Through stands never get a jet bridge. Cost and box are the remote values of the size, stored as `cost.through` in `stand_sizes.json`.
* Markings: the nose in remote set (restraint lines, stop ladder, emergency triangle, GSE box, bus bay) plus lead out line with arrow, marshaller spot, dashed fuel truck box and a zebra walkway to the bus bay.

## Requirements

1. The stand tool offers the through type for every size (build menu entry and context bar picker). The ghost snaps its lead in like any stand.
2. The network adds a one way lead out edge kind for the stem and both arcs. Only a route that starts at that stand may use it. The lead in of a stand with a lead out is one way toward the stand.
3. A departing aircraft on a stand with a lead out drives forward from its stop bar along the rest of the lead in and the lead out, with no push back state.
4. The parked box may sit off the pavement of the lead out taxiway without a clearance breach.
5. The inspector shows whether the stand has a lead out, and hides the push back picker when it does.
6. Markings per the decisions above, at the zoom tiers of nose in stands.

## Acceptance

* A test airport with a through stand between two parallel taxiways: an arrival parks and departs forward, never in the Pushback state; with the front taxiway removed it pushes back.
* Determinism test: 2 000 ticks twice from one seed with a through stand, identical hashes.
* Screenshot of a through stand compared with the sheet.
