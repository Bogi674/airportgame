# T46. Baggage levels, transfers and bridges

Milestone: after MVP 1 (deferred by the user on 2026-11-06). Split out of T43.

## Goal

Baggage runs on more than one level inside a terminal. A floor selector picks the level being edited, level transfers are the only link between levels, and bridges carry conveyors over and under other runs and service roads.

## Why it is separate

The user said on 2026-11-06: "multi level can be trimmed for later. but working baggage system is a must." T43 therefore delivers a working single level baggage system, and this task adds the vertical layer on top of it.

## Requirements

* R1. A level layer on `TerminalGrid`, saved, with a save version bump and a migration (recipe R3).
* R2. A floor selector in the terminal tools, showing one baggage level at a time.
* R3. A level transfer device, the only edge between two levels. Runs on different levels that overlap in the grid never connect.
* R4. Bridges over and under, with clearance height data, so the T26 collision checks apply.
* R5. Tests: overlapping runs on two levels never exchange bags; a transfer is the only crossing; old saves load with every device on level 0.

## Depends

T43.
