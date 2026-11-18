# BAGGAGE.md

The baggage network: what the player places, how the game connects it, how it looks and how it is simulated. This document wins over every older line about baggage in other docs. Section 12 lists the lines it replaces.

Reference sheet: `docs/art/baggage_kit.png`. Node art: `docs/reference/sprite-prototypes/fixtures_baggage.py`. Reference logic for the automatic links, the L path search and the routing lookups: `docs/reference/sprite-prototypes/baggage_links.py` (run it to see rules A to E pass). Exported sprites: `src/data/fixtures/sprites/baggage.json`, catalog entries in `src/data/fixtures/catalog.json` (`docs/TERMINAL_FIXTURES.md`).

## 1. Principles

1. The player places nodes. The player never builds belts. The game generates the under floor belts between nodes.
2. Every node shows a ramp stub, a short belt that sinks into the floor or rises out of it. The belts read as hidden under the floor.
3. Connections are chosen in menus on the nodes. Defaults are filled in automatically, so a new airport works without opening a single menu.
4. Rules are forgiving. A missing link never blocks the game. It raises a warning and the affected bags wait or are reported missing.
5. Bags move as batches per flight, never as individual objects.

## 2. Release scope

| Capability | MVP 1 | MVP 2 |
| --- | --- | --- |
| Bag drop point, as a check in desk with bag drop or a self bag drop | Yes | Yes |
| Baggage screening room with screening machines | Yes | Yes |
| Baggage bay assigned to stands, with a truck edge on the apron | Yes | Yes |
| Baggage carousel fed by a bay | Yes | Yes |
| Ramp stub on every node | Yes | Yes |
| Link objects between nodes | Yes, all automatic and hidden | Yes, automatic or chosen in menus |
| Connection menus on nodes | Read only lines with an Auto chip | Editable on every node |
| Under floor lines drawn | No | In the baggage overlay and when a node is selected |
| Belt cost and upkeep | None | Per meter of link |
| Link capacity | None | Yes |
| Transit time along the link | Yes | Yes |
| Node throughput and buffers | Yes | Yes |
| Stand inspector bay assignment | Yes | Yes |

Not built in either release: sorting halls, transfer bags, alarm benches and manual search, oversize baggage, free standing bay sheds, lost baggage desks, belts between floors. These sit with the MVP 2 list in `ROADMAP.md` section 5, and belts between floors belong to the multi floor work (T51, T46).

## 3. Nodes

### 3.1 The two chains

```
Departures:  Drop point  >  Screening machine  >  Baggage bay  >  Baggage truck  >  Aircraft
Arrivals:    Aircraft  >  Baggage truck  >  Baggage bay  >  Baggage carousel
```

A baggage bay serves both chains. Departure bags enter it through its in ramp. Arrival bags leave it through its out ramp.

### 3.2 Node table

| Node | Footprint on the 2 m grid | Zone | Ramps |
| --- | --- | --- | --- |
| Drop point, check in desk with bag drop | The check in desk, 2 by 2 m, in all three levels. Its belt runs down the middle of the cell so it meets the ramp. A desk gets the option Accepts bags, on by default for airline desks | Landside departures | One out ramp behind the desk |
| Drop point, self bag drop | The Bag drop fixture, 4 by 2 m, 40 s service | Landside departures | One out ramp behind the left cell |
| Screening machine | 4 by 2 m. Light grey tunnel with dark openings at both ends, rubber curtains, plus a console beside it | Inside a baggage screening room | One in ramp at one short end and one out ramp at the other short end. 8 by 2 m with both ramps |
| Baggage bay | Width 2 to 8 cells, which is 4 to 16 m, and depth 4 cells, which is 8 m | Airside, on an exterior wall facing the apron | In ramp in the left cell and out ramp in the right cell of the back row, inside the body |
| Baggage carousel | 4 by 20 m | Landside arrivals hall after immigration | One in ramp, one cell outside the feed end |

UI labels use Baggage drop point, Baggage screening machine, Baggage bay and Baggage carousel.

### 3.3 Baggage screening room

A room type named `baggage_screening`. It is a staff only room (zone Staff in `docs/TERMINAL_ZONING.md`).

* Closed walls and at least one door.
* At least one screening machine with both of its ramps inside the room.
* Minimum area 24 m2.
* Passenger walking never enters it. Staff walking does.
* A machine outside a valid room stays halted and shows a warning.
* Each machine needs one security officer from the staffing system. An unstaffed machine halts and shows in the staffing coverage overlay.

### 3.4 Baggage bay

* The bay body sits on the terminal grid. Its truck edge is one long side on an exterior wall that faces airside. The game cuts a truck opening in that wall and draws a roll up door.
* One truck slot per 4 m of width. A slot holds one baggage tractor with its carts, up to 16 m long.
* In front of every slot the game reserves a staging lane of 4 m by 16 m on apron pavement. The lane must be clear of aircraft footprints and stand restraint areas.
* The truck edge must connect to the service road graph, the same connection test used for stands. If it does not, the bay shows Not connected to a service road and no truck can serve it.
* A bay has a staging buffer for bags, drawn as a makeup belt across the back of the bay. Departure bags wait there for their flight. Arrival bags wait there for the out ramp.
* A bay has no vehicles of its own. Trucks come from the GSE depot as in `docs/GAME_DESIGN.md` section 10.

### 3.5 Ramp stub placement

* A ramp stub is one 2 by 2 m cell attached to a node edge. It rotates with the node in 90 degree steps.
* A ramp cell must be free floor on the node's floor index. A wall, a door swing or another fixture makes the placement invalid.
* A ghost shows the node and all its ramp cells together. Any blocked ramp cell turns the ghost red with the reason in the context bar.
* An out ramp on a node with an even width sits at the first cell on the left when seen from the passenger side.
* Ramp cells per asset are listed in the catalog field `ramps`, in 2 m cells relative to the footprint.

## 4. Connections

### 4.1 Allowed links

A link is directed. It joins an out ramp to an in ramp. Both nodes must be on the same floor index.

| From | To | Rule |
| --- | --- | --- |
| Drop point | Screening machine | A drop point has exactly one machine. A machine takes many drop points |
| Screening machine | Baggage bay | A machine feeds one or many bays. A bay takes many machines |
| Baggage bay | Baggage carousel | A bay feeds exactly one carousel. A carousel takes many bays |

A ramp can merge many links in and split many links out. Merging and splitting cost nothing.

### 4.2 Link geometry

The game generates the path. The player never draws it.

* An L shaped polyline on the 2 m grid between the two ramp cells. The game tries both L variants and keeps the shorter valid one. A tie goes to the variant with its first turn closest to the source.
* Length is the sum of the segment lengths between cell centers.
* A link is valid only when all of these hold.
  * The path stays on owned land.
  * The path does not cross a runway, a taxiway or stand pavement.
  * The length does not exceed `maxLinkLengthM`.
  * Both nodes are on the same floor index.
* An invalid pair shows its reason in the menu. Examples are Crosses taxiway B, Longer than 300 m, Different floor, Outside owned land.
* A path may pass under buildings, rooms, roads and other links.

### 4.3 Automatic fill

The game fills links so the network works without menus. The same rules run in MVP 1 and MVP 2. `baggage_links.py` implements them and the chain scene of `baggage_kit.png` is drawn from its output.

* **A.** Placing a drop point links it to the valid machine with the shortest link. A tie goes to the lowest id.
* **B.** Placing a bay links it to the valid carousel with the shortest link. A tie goes to the lowest id.
* **C.** Assigning a stand to a bay creates a machine to bay link for every machine that has at least one drop point and no link to that bay yet.
* **D.** Placing a machine, or moving a drop point onto it, creates links to every bay that serves at least one stand. Drop points with no machine yet are linked to the new machine.
* **E.** Unassigning the last stand from a bay removes the automatic links that only that bay needed. Links chosen by the player stay.
* **F.** Deleting a node never triggers a refill. Affected nodes show a Warning chip and a Fix automatically button that runs rules A to D again for that node.

Each link stores a mode, `auto` or `manual`. A link the player sets or edits in a menu becomes `manual`. Choosing Automatic in a menu returns the link to `auto`.

### 4.4 Routing

The chain has three layers, so routing is a lookup and needs no pathfinding.

* **Departure bag.** Drop point D, then machine M of D, then the bay B of the flight's stand. This needs a link from M to B. If the link is missing the bags are unrouted. They wait in the machine buffer, the flight shows Bags not routed to Bay B, and the bags are reported missing at the loading deadline.
* **Arrival bag.** The bay B of the arrival stand, then the carousel C that B feeds. If B has no carousel link the bags wait in the bay and the flight shows Bay B has no carousel.

### 4.5 Timing and capacity

* **Transit.** `lengthM / beltSpeedMps` per link.
* **Link capacity.** `linkCapacityBagsPerHour`, MVP 2 only. Bags above capacity queue in the upstream node buffer.
* **Drop point.** Bags enter its buffer after the passenger service time. When the buffer is full the counter stops serving and the passenger queue grows.
* **Screening machine.** First in, first out. One bag per `secondsPerBag`. It needs a valid room and a security officer. Its buffer holds `bufferBags`.
* **Bay.** Departure bags wait in the staging buffer. Each truck slot loads at `loadSecondsPerBag`. Arrival bags unloaded from a truck wait for the out ramp.
* **Carousel.** Holds 60 bags. When it is full the bay holds arrival bags and trucks wait at their slots.
* **Back pressure.** A full buffer blocks the node upstream of it. The overlay shows the chain from the blocked node back to its source.

### 4.6 Deadlines and consequences

* Check in closes 45 minutes before departure, as in `docs/GAME_DESIGN.md` section 10.
* The last cart must leave the bay `loadingDeadlineMin` minutes before departure. Bags that are not in the bay by then are left behind and count as missing bags. The flight still departs on time.
* Missing bags lower satisfaction through a `missingBagWeight` term in the satisfaction data.
* A flight at a commercial stand with no bay can still be booked. The booking shows a Warning and every checked bag on it is reported missing. GA stands need no bay.
* Claim wait on arrival is the time from the aircraft doors opening to the first bag reaching the carousel. It feeds satisfaction.

### 4.7 Stand assignment

* A stand has one `bayId`. A bay serves many stands. Truck slots limit how many trains load at the same time, not how many stands the bay serves.
* The stand inspector shows a Baggage bay dropdown. The list shows each bay with its slot use and its connection state.
* The stand inspector shows the arrival carousel as a read only line derived from the bay. A shortcut button jumps to the bay. This replaces the separate arrival carousel assignment in Revision 4.
* In both directions the truck goes between the bay slot and the stand's belt loader. Turnaround tasks for baggage loading and unloading start and end at the bay slot. Docking poses at the slot put the last cart on the truck edge line.

## 5. Connections tab

For the four node kinds, the Settings tab of the inspector is named Connections and holds the fields below followed by the node's own settings. The inspector keeps its limit of four tabs.

In MVP 1 the tab shows the same fields as read only lines. Each line carries an Auto chip, and no dropdown opens. Everything below describes the editable tab of MVP 2.

| Node | Fields |
| --- | --- |
| Drop point | To: Screening machine, single select. Bays reached through this machine: chips with an Add bay dropdown. Accepts bags toggle on check in desks |
| Screening machine | From: Drop points, multi select. To: Baggage bays, multi select |
| Baggage bay | From: Screening machines, multi select. To: Baggage carousel, single select. Stands: multi select with add and remove. Truck slots readout |
| Baggage carousel | From: Baggage bays, multi select |

Both ends can edit a link. Choosing a drop point in a machine's From list moves that drop point away from its old machine. Choosing a carousel in a bay's To field removes that bay from its old carousel.

### 5.1 Option rows

* Each option row shows the node name, a short location label, a load chip in percent, the link length, the cost and the transit time.
* A disabled row shows its reason.
* The first row of a single select is Automatic.
* Single selects accept None. A node with None shows a Warning chip.
* The Add bay dropdown on a drop point edits the machine's outputs. The field shows a note such as Also serves 3 other drop points, so the player knows the change is shared.

### 5.2 Preview

Hovering an option draws the candidate path on the map as a ghost line with its length, cost and transit time. The line is blue when valid and red when invalid. Nothing changes until the player clicks.

### 5.3 Commit

Changes apply at once and go through the undo stack. Cost is paid when a link is created and is not refunded when it is removed. Upkeep runs per game year on total link length.

### 5.4 Link selection

Clicking an under floor line while the baggage overlay is on opens a small popover with the two end nodes, length, load, cost and a Remove link button.

### 5.5 Connection chips (decided 2026-11-18)

| Chip | Color | Meaning |
| --- | --- | --- |
| Auto | #2f6fd1 | The link was made by rules A to D and follows them on later changes |
| Manual | #5d6672 | The player chose the link in a menu. Rules never remove it |
| Not connected | #d9534f | No valid link exists for this field. The reason shows in the row |
| Warning | #b8862b | A link is missing, a buffer is full or the node is unstaffed |

## 6. Overlay and alerts

### 6.1 Baggage load overlay

The overlay named Baggage load in `docs/UI_DESIGN.md` shows under floor lines as bands.

* Color by load. Green below 60 percent, amber from 60 to 90 percent, red above 90 percent.
* Departure lines use solid chevrons and arrival lines use hollow chevrons, so color is never the only signal. Chevrons scroll only while bags flow; an idle link keeps its chevrons still and grey (decided 2026-11-18, closes the open point from the baggage asset canvas).
* A ring around each node shows its buffer fill.
* A blocked node shows a back pressure marker and the chain behind it is highlighted.
* The legend chip lists the colors, the chevron styles and the ring.

### 6.2 Alerts and chips

| Condition | Severity | Shown on |
| --- | --- | --- |
| Drop point has no machine | Warning | Drop point inspector, alert center |
| Machine outside a valid screening room | Warning | Machine inspector, room validation |
| Machine unstaffed | Warning | Staffing coverage overlay, alert center |
| Machine has no bay link | Warning | Machine inspector |
| Bay has no carousel link | Warning | Bay inspector |
| Bay truck edge not connected to a service road | Warning | Bay inspector, stand inspector |
| Stand has no bay | Warning | Stand inspector, booking dialog |
| Bags missing on a departing flight | Warning | Flight inspector as a delay reason |
| Link above 90 percent load for 10 minutes | Info | Baggage load overlay |
| Carousel full | Info | Carousel inspector |

## 7. Art

Everything in this section is drawn in `docs/art/baggage_kit.png` and exported to `src/data/fixtures/sprites/baggage.json`.

### 7.1 Ramp stub

A ramp is the signature look of this system. It must read as a belt going into the floor in one glance.

* One 2 by 2 m cell. The belt is 0.8 m wide, centered, and runs along the port direction.
* **Out ramp, bags sink.** The belt starts level with the node edge, runs flat for 0.8 m, slopes down for 0.8 m and ends at a dark slot that crosses the cell for 0.4 m.
* **In ramp, bags rise.** The same geometry with the chevrons pointing toward the node: the belt emerges from the slot and brightens toward the node.
* Shading runs from belt color `#4a5058` at the flat end to `#14181d` at the slot. The slot is `#0b0e12` with a 0.1 m steel lip `#9aa3ad` on its floor side.
* Side rails are 0.1 m wide in `#c5ccd4` and run from the node to the slot. A 0.2 m frame in the wall color `#2c3441` surrounds the opening. A soft 0.3 m shadow sits on the floor beside the rails.
* Chevrons 0.3 m long show the flow. Departure chevrons use `#3b82c4` and arrival chevrons use `#e0a030`. Idle chevrons are grey.
* An unconnected ramp has grey chevrons and a dashed red outline `#d9534f` of 0.1 m.
* Detail tiers follow `docs/TERMINAL_FIXTURES.md` section 3. Tier 1 keeps the belt strip, tier 2 adds rails and the slot, tier 3 adds roller lines and chevrons. At tier 3 the chevrons scroll in a 4 frame loop, only while bags flow and only inside the viewport.
* Catalog ids: `ramp.out`, `ramp.in`, `ramp.outArr`, `ramp.inArr`, `ramp.unconnected`.

### 7.2 Node sprites

* **Check in desk with bag drop.** The check in desk of every level, with its belt lane in the middle of the cell aligned with the ramp cell behind it (`checkIn.l1` to `checkIn.l3`).
* **Self bag drop.** The Bag drop sprite with its belt lane centered on the left cell, aligned with the ramp (`bagDrop`).
* **Screening machine.** A 4 by 2 m light grey box with dark tunnel openings at both ends and darker rubber curtain bars, both ramps drawn in one straight belt axis (`screeningMachine`). The console with two screens and a chair is its own asset (`screeningConsole`).
* **Baggage bay.** Concrete grey floor `#8d949c` with a yellow painted border, in and out ramps in the back row, a makeup belt with bags, cart parking lines and a numbered slot box per 4 m slot, a 0.3 m yellow and black hazard stripe and a dashed roll up door per slot on the truck edge, and the floor label BAY with its number (`baggageBay.w2` to `baggageBay.w8`).
* **Staging lane.** A white outlined box with white hatching at its base and the text BAGS, in the same style as the GSE parking box in `docs/DESIGN_REVISION_3.md` section 3 item 7 (`stagingLane`).
* **Baggage carousel.** A 20 by 4 m racetrack of inclined plates around a central island, bags on the plates, the feed belt and the in ramp at the feed end (`carousel`).

### 7.3 Under floor lines

* Drawn only while the baggage overlay is on or while a node or link is selected.
* Drawn above floors and fixtures at 70 percent opacity, so they read as a ghost view through the floor. They are never drawn in the normal view.
* A band 0.8 m wide with 0.1 m dashed edges and chevrons every 1.6 m in the flow color. Selected links are drawn at full opacity. Reference: `fixtures_baggage.link_band` and `fixtures_baggage.buffer_ring`.
* Add the tokens `baggageDeparture`, `baggageArrival` and `baggageWarning` to `src/ui/tokens`.

### 7.4 Art checks

* Every ramp cell counts as fixture footprint in the grid and in the collision check.
* No label overflows its box. No element overlaps another unless it is physically under it.
* The sheet is `docs/art/baggage_kit.png`, listed in `docs/ART_AND_ASSETS.md` section 14.

## 8. UI additions

* The Terminal flyout gets tool cards for Self bag drop, Screening machine, Baggage bay and Baggage carousel. The room tool gets the room type Baggage screening. The check in desk tool gets the Accepts bags option.
* The context bar shows live readouts while placing a node. They are ramp cells valid, room valid, truck edge connected, cost and build time.
* The Baggage load overlay joins the overlay list as already named in `docs/UI_DESIGN.md`.
* The guided start does not teach baggage. A single hint appears the first time a stand shows Stand has no bay.

## 9. Simulation and architecture

* Code lives in `src/sim/ops/baggage/`. Content values live in `src/data/baggage.json` with a zod schema.
* Port the behaviour of `baggage_links.py`: the `Network` class maps to the struct of arrays below, its methods to commands and cached lookups.
* Hot data uses struct of arrays.

```
nodes:    id, kind, cell, rot, floor, roomId, flags, bufferCount, ratePerHour
ports:    nodeId, side, dir, cell
links:    id, fromPort, toPort, mode, lengthM, pathStart, pathLen, queue
pathCells shared Int32Array that links index into
batches:  flightId, count, dir, stage, nodeOrLink, readyTick
standBay: standId to bayId
```

* Batches advance by `readyTick`. Nodes serve with a token budget per tick. There are no per bag objects and no per bag pathfinding.
* Lookups `machineOf`, `bayOf`, `linkMachineBay` and `carouselOf` are built on a command and cached. The tick never searches.
* One forked RNG stream named `baggage` adds a small jitter to service time. Bag counts come from the cohort `bags` field.
* Snapshot additions are node buffer fill and link load, sent at a low rate and only while the overlay is on. Link geometry goes to the renderer as `staticData` of kind `baggageLinks`, sent on change only.
* Commands, all serializable and undoable.
  * `placeBaggageNode`
  * `removeBaggageNode`
  * `setBaggageLink`
  * `removeBaggageLink`
  * `setStandBay`
  * `setAcceptsBags`
  * `fixBaggageNode`
* The legacy `belt` entry of `FIXTURE_KEYS` keeps its index. New placements use the carousel. Recommended migration: each saved belt becomes a carousel anchor on load. **Confirm** in the T43 interview.
* Saves get the new arrays, a version bump and a migration. An older save gets no baggage nodes, and its existing bag drop fixtures gain their ramp cells and automatic links on load.
* Record the baggage decisions in `docs/ARCHITECTURE.md` under Decisions.

## 10. Tests

* Determinism test over 2 000 ticks with a full chain running.
* Automatic fill rules A to F as unit tests, including tie breaks by lowest id. Port the checks in the `__main__` block of `baggage_links.py`.
* Link geometry tests for both L variants, tie breaks and every invalid reason.
* Routing lookup tests for departures and arrivals, including the unrouted and missing carousel cases.
* Saturation test. A slow machine fills its buffer and blocks the drop point, and the passenger queue grows.
* Deadline test. Bags that arrive after the loading deadline are reported missing and the flight still departs.
* Property test. Any layout where every node has a valid link delivers all bags eventually.
* Placement tests for blocked ramp cells, invalid rooms and a bay truck edge with no service road.
* Save and load hash test with baggage nodes and links.
* Menu tests, MVP 2 only. Both ends edit the same link, Automatic restores `auto`, disabled rows show reasons.
* Visual regression for the ramp stub at tiers 1 to 3 and for the baggage kit sheet.
* `npm run stress` includes a scenario with 50 aircraft and a busy baggage network, and stays under budget.

## 11. Numbers

All values are starting values in `src/data/baggage.json`. Rows marked Confirm go in the decision batch with the recommended value, so no agent invents them silently.

| Key | Starting value | Status and reason |
| --- | --- | --- |
| `beltSpeedMps` | 0.8 | Typical airport belts run 0.5 to 1 m/s |
| `linkCapacityBagsPerHour` | 1800 | Typical belt throughput. MVP 2 only |
| `maxLinkLengthM` | 300 | Keeps links local to one terminal zone |
| `dropPoint.bufferBags` | 30 | Confirm. Lets a desk absorb a short stall |
| `screeningMachine.secondsPerBag` | 10 | About 360 bags per hour for one machine |
| `screeningMachine.bufferBags` | 20 | Confirm |
| `screeningMachine.officers` | 1 | Uses the existing security officer role |
| `bay.depthM` | 8 | Fits the 4 cell depth |
| `bay.slotWidthM` | 4 | One train lane |
| `bay.bufferBags` | 200 | Confirm |
| `bay.loadSecondsPerBag` | 6 | Confirm. About 600 bags per hour per slot |
| `bay.stagingLaneM` | 16 | A tractor and three carts is 14.6 m |
| `carousel.capacityBags` | 60 | Matches the carousel row in `docs/GAME_DESIGN.md` section 8 |
| `loadingDeadlineMin` | 15 | Confirm. Last cart leaves the bay this long before departure |
| `linkCostPerM` | 150 | Confirm. MVP 2 only. A trench belt costs more than pavement at 90 per m2 |
| `linkUpkeepPctPerYear` | 2 | Confirm. MVP 2 only. Matches asphalt upkeep |
| `missingBagWeight` | to be proposed | Confirm. Add to the satisfaction weights list in `handoff/QUESTIONS.md` |
| Fixture build costs | to be proposed | Confirm. Set in the same data file as the other fixtures |

## 12. Lines this document replaces

| Where | Old text | New rule |
| --- | --- | --- |
| `docs/GAME_DESIGN.md` section 8 | Bag drop and Baggage carousel rows | New rows for the screening machine and the baggage bay, see `docs/TERMINAL_FIXTURES.md` |
| `docs/GAME_DESIGN.md` section 10 | Abstract network of belt segments with sorting | Replaced by this document |
| `ROADMAP.md` T43 row | Working baggage system on one level: belts, makeup chutes and carousels | Replaced by the MVP 1 column of section 2 |
| `docs/DESIGN_REVISION_4.md` | Baggage makeup chute | The term is baggage bay |
| `docs/DESIGN_REVISION_4.md` | Arrival carousel assigned in the stand inspector | Derived from the stand's bay, see section 4.7 |
| `handoff/tasks/T43-baggage-system.md` | Directed conveyors, junctions and splitters built by the player | Reconciled on 2026-11-18: the spec now points here |
