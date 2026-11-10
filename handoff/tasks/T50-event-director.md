# T50. Seeded event director with a data driven deck

Milestone M6. User decision, 2026-11-10: a seeded event director that draws from a data driven deck with player choices, so no two playthroughs match. Status `blocked` until the user answers the open questions.

## Goal

A director in the sim draws events from a deck in `src/data`, on its own forked RNG stream. Each event offers the player choices with consequences. A different seed gives a different run of events, and the same seed plus the same commands gives the same run.

## Read first

* `docs/GAME_DESIGN.md` section 14 (events) and section 15 (difficulty presets).
* The existing weather events (rain, fog, strong wind) in `src/sim` and their data.
* `src/sim/rng.ts`, `src/sim/commands.ts`, `src/ui/alerts.ts`.
* `handoff/RECIPES.md` for commands, data, save fields and strings.

## Requirements

* R1. The deck is JSON under `src/data`, validated by zod. Adding an event needs no code change when it uses existing effect kinds.
* R2. The director uses a forked seeded stream and no other randomness. The existing weather events move into the deck.
* R3. An event with choices waits for a player command. The choice is a serializable command, so replays match.
* R4. Director state is saved, with a save version bump and a migration.
* R5. Determinism test: 2 000 ticks twice from one seed, identical `stateHash`, with at least one event drawn and one choice made. A second test shows that two seeds give different event runs.

## Open questions, all block the task

Ask the user, never invent:

1. Which events are in the first deck, with their effects and choices.
2. Trigger windows, durations, weights and how frequency scales with airport size or difficulty.
3. What happens when the player does not choose in time.
4. Costs and effect sizes for every choice.
