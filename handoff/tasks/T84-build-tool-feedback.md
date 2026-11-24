# T84 Build tool feedback

Goal: fix the ten items of the owner's feedback of 2026-11-24 on the taxiway, apron and road tools and on taxiing at corners. Decisions: `handoff/QUESTIONS.md`, section "2026-11-24 T84".

## Read first

`docs/DESIGN_REVISION_2.md` sections 2.1 to 2.4, `docs/UI_DESIGN.md` (tools, context bar), `docs/ARCHITECTURE.md` section 5.1 (taxi network), `handoff/PITFALLS.md`.

## Findings

* Item 1: the taxilane snap works; the ghost hides it. After a click the snap marker is gone and the strip end has a square cap that runs past the centerline to the far edge, so a joined end looks loose.
* Items 3 and 6: `alignGuide` anchors the points being drawn to the world axes only, ignores apron edges and keeps a single guide.
* Item 10: the taxi network uses the raw taxiway polylines, so aircraft turn at the node while the paint and pavement follow the fillets.

## Requirements

1. A joined end of a taxiway or taxilane ghost ends at the centerline it joins, and every point laid so far keeps its snap marker.
2. Alignment guides come from apron edges, taxiway and runway axes and the lines at right angles to them, then the world axes as the lowest priority. The active guide is drawn from the point or edge it follows, and the tooltip names it (for example "Parallel to apron edge").
3. When two guides cross within the guide tolerance of the cursor, the point snaps to the crossing and both guides are drawn.
4. Where an apron touches a taxiway, the pavement runs through with no shoulder or gap, and the taxiway edge line along the shared stretch is drawn dashed.
5. A taxiway or taxilane drawn into a runway gets the junction the parallel tool gives: lead in centerlines into the runway centerline both ways and pavement fillets whose yellow edge lines curve out and stop at the runway edge. The white runway edge stripe stays continuous across the junction.
6. The tool rail has one Apron button. Its flyout has Build, Extend and Remove tabs; Rectangle and Polygon stay in the context bar.
7. Every rectangle tool places by click, move, click: the first click fixes a corner, the rectangle follows the cursor, the second click fixes the other corner and opens the build confirmation. Press and drag still works.
8. Before the first click the service road tool shows a short road stub ghost at the cursor and the road snap points nearby; over a snap point it locks on and names it. The depot and building tools show the same nearby road snap points and their own door stub while placing.
9. Aircraft taxi along the bend and junction turn curves that the pavement and paint show, never through the corner point.

## Acceptance

* Screenshots of each item from `handoff/scenarios/T84-*.json`.
* A network test: on an L shaped taxiway every sample of the bend lies on the fillet arc, and a junction turn routes over the arc edge.
* Determinism test: 2 000 ticks twice from one seed on an airport with bends, identical hashes.
* Full `npm run verify` passes and the budgets hold.
