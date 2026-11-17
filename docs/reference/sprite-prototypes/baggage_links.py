"""Reference logic for the automatic baggage network of docs/BAGGAGE.md section 4.

The player places nodes; the game links them under the floor. This module is the behaviour to port to
src/sim/ops/baggage/: node and port model, the L shaped path search on the 2 m grid, automatic fill rules A to F
with lowest id tie breaks, and the routing lookups. Pure functions, deterministic, no randomness.

Grid coordinates are 2 m cells. A port is the ramp cell of a node.
"""
from dataclasses import dataclass, field

KINDS = ("drop", "machine", "bay", "carousel")
ALLOWED = {("drop", "machine"), ("machine", "bay"), ("bay", "carousel")}


@dataclass
class Node:
    id: int
    kind: str
    floor: int = 0
    in_port: tuple = None       # ramp cell (cx, cy) or None
    out_port: tuple = None
    stands: list = field(default_factory=list)   # bays only: stand ids served


@dataclass
class Link:
    src: int
    dst: int
    mode: str                  # "auto" or "manual"
    cells: list
    length_m: float


class Network:
    def __init__(self, blocked=(), owned=None, max_len_m=300.0):
        """blocked: list of (x0, y0, x1, y1) cell rectangles a path may not enter (runway, taxiway, stand
        pavement). owned: (x0, y0, x1, y1) owned land in cells or None for unlimited."""
        self.nodes = {}
        self.links = []
        self.blocked = list(blocked)
        self.owned = owned
        self.max_len_m = max_len_m

    # ------------------------------------------------------------------ geometry
    def _cell_ok(self, c):
        x, y = c
        if self.owned and not (self.owned[0] <= x <= self.owned[2] and self.owned[1] <= y <= self.owned[3]):
            return "Outside owned land"
        for x0, y0, x1, y1 in self.blocked:
            if x0 <= x <= x1 and y0 <= y <= y1:
                return "Crosses airfield pavement"
        return None

    @staticmethod
    def _l_cells(a, b, horizontal_first):
        (ax, ay), (bx, by) = a, b
        cells = [a]
        x, y = ax, ay
        legs = [("x", bx), ("y", by)] if horizontal_first else [("y", by), ("x", bx)]
        for axis, target in legs:
            while (x if axis == "x" else y) != target:
                if axis == "x":
                    x += 1 if target > x else -1
                else:
                    y += 1 if target > y else -1
                cells.append((x, y))
        return cells

    def path(self, src_port, dst_port, src_floor=0, dst_floor=0):
        """Shorter valid L variant; on a tie the variant whose first turn is closest to the source.
        Returns (cells, length_m, None) or (None, None, reason)."""
        if src_floor != dst_floor:
            return None, None, "Different floor"
        best, reason = None, None
        for hf in (True, False):
            cells = self._l_cells(src_port, dst_port, hf)
            bad = next((r for r in (self._cell_ok(c) for c in cells) if r), None)
            length = 2.0 * (len(cells) - 1)
            if bad:
                reason = bad
                continue
            if length > self.max_len_m:
                reason = f"Longer than {int(self.max_len_m)} m"
                continue
            turn = abs(dst_port[0] - src_port[0]) if hf else abs(dst_port[1] - src_port[1])
            key = (length, turn)
            if best is None or key < best[0]:
                best = (key, cells, length)
        if best is None:
            return None, None, reason
        return best[1], best[2], None

    # ------------------------------------------------------------------ editing
    def add(self, node):
        self.nodes[node.id] = node
        if node.kind == "drop":
            self._rule_a(node)
        elif node.kind == "bay":
            self._rule_b(node)
        elif node.kind == "machine":
            self._rule_d(node)
        return node

    def links_from(self, nid):
        return [l for l in self.links if l.src == nid]

    def links_to(self, nid):
        return [l for l in self.links if l.dst == nid]

    def _link(self, a, b, mode="auto"):
        if (a.kind, b.kind) not in ALLOWED:
            return None
        if any(l.src == a.id and l.dst == b.id for l in self.links):
            return None
        cells, length, reason = self.path(a.out_port, b.in_port, a.floor, b.floor)
        if cells is None:
            return None
        l = Link(a.id, b.id, mode, cells, length)
        self.links.append(l)
        return l

    def _nearest(self, src, kind, as_target=True):
        """Valid node of kind with the shortest link, lowest id on a tie."""
        best = None
        for n in sorted(self.nodes.values(), key=lambda n: n.id):
            if n.kind != kind:
                continue
            a, b = (src, n) if as_target else (n, src)
            cells, length, _ = self.path(a.out_port, b.in_port, a.floor, b.floor)
            if cells is not None and (best is None or length < best[0]):
                best = (length, n)
        return best[1] if best else None

    def _rule_a(self, drop):
        """A. A new drop point links to the valid machine with the shortest link."""
        m = self._nearest(drop, "machine")
        if m:
            self._link(drop, m)

    def _rule_b(self, bay):
        """B. A new bay links to the valid carousel with the shortest link."""
        c = self._nearest(bay, "carousel")
        if c:
            self._link(bay, c)

    def assign_stand(self, bay_id, stand_id):
        """C. Assigning a stand creates a machine to bay link for every machine that has a drop point and no
        link to that bay yet."""
        bay = self.nodes[bay_id]
        if stand_id not in bay.stands:
            bay.stands.append(stand_id)
        for m in sorted(self.nodes.values(), key=lambda n: n.id):
            if m.kind == "machine" and self.links_to(m.id):
                self._link(m, bay)

    def _rule_d(self, machine):
        """D. A new machine links to every bay that serves at least one stand, and takes drop points that have
        no machine yet."""
        for b in sorted(self.nodes.values(), key=lambda n: n.id):
            if b.kind == "bay" and b.stands:
                self._link(machine, b)
        for dnode in sorted(self.nodes.values(), key=lambda n: n.id):
            if dnode.kind == "drop" and not self.links_from(dnode.id):
                self._link(dnode, machine)

    def unassign_stand(self, bay_id, stand_id):
        """E. Unassigning the last stand removes the automatic links only that bay needed. Manual links stay."""
        bay = self.nodes[bay_id]
        if stand_id in bay.stands:
            bay.stands.remove(stand_id)
        if not bay.stands:
            self.links = [l for l in self.links if not (l.dst == bay_id and l.mode == "auto"
                                                         and self.nodes[l.src].kind == "machine")]

    def remove(self, nid):
        """F. Deleting a node removes its links and never refills. Affected nodes show a Warning chip."""
        self.links = [l for l in self.links if l.src != nid and l.dst != nid]
        self.nodes.pop(nid, None)

    def fix(self, nid):
        """Fix automatically: run rules A to D again for one node."""
        n = self.nodes[nid]
        {"drop": self._rule_a, "bay": self._rule_b, "machine": self._rule_d}.get(n.kind, lambda _n: None)(n)

    # ------------------------------------------------------------------ routing
    def machine_of(self, drop_id):
        l = self.links_from(drop_id)
        return l[0].dst if l else None

    def bay_of_stand(self, stand_id):
        for n in sorted(self.nodes.values(), key=lambda n: n.id):
            if n.kind == "bay" and stand_id in n.stands:
                return n.id
        return None

    def carousel_of(self, bay_id):
        l = [x for x in self.links_from(bay_id) if self.nodes[x.dst].kind == "carousel"]
        return l[0].dst if l else None

    def route_departure(self, drop_id, stand_id):
        """Drop point, its machine, the bay of the flight's stand. None with a reason when a link is missing."""
        m = self.machine_of(drop_id)
        if m is None:
            return None, "Drop point has no machine"
        b = self.bay_of_stand(stand_id)
        if b is None:
            return None, "Stand has no bay"
        if not any(l.src == m and l.dst == b for l in self.links):
            return None, f"Bags not routed to Bay {b}"
        return (drop_id, m, b), None

    def warnings(self):
        out = []
        for n in sorted(self.nodes.values(), key=lambda n: n.id):
            if n.kind == "drop" and not self.links_from(n.id):
                out.append((n.id, "Drop point has no machine"))
            if n.kind == "machine" and not [l for l in self.links_from(n.id)]:
                out.append((n.id, "Machine has no bay link"))
            if n.kind == "bay" and self.carousel_of(n.id) is None:
                out.append((n.id, "Bay has no carousel"))
        return out


if __name__ == "__main__":
    net = Network(blocked=[(40, 0, 60, 10)])
    net.add(Node(1, "drop", out_port=(2, 1)))
    assert net.machine_of(1) is None
    net.add(Node(2, "machine", in_port=(10, 5), out_port=(14, 5)))
    assert net.machine_of(1) == 2, "rule D adopts the orphan drop point"
    net.add(Node(3, "drop", out_port=(4, 1)))
    assert net.machine_of(3) == 2, "rule A"
    net.add(Node(4, "carousel", in_port=(20, 20)))
    net.add(Node(5, "bay", in_port=(30, 12), out_port=(32, 12)))
    assert net.carousel_of(5) == 4, "rule B"
    assert net.route_departure(1, 22)[0] is None
    net.assign_stand(5, 22)
    assert net.route_departure(1, 22)[0] == (1, 2, 5), "rule C"
    net.unassign_stand(5, 22)
    assert net.route_departure(1, 22)[0] is None, "rule E"
    cells, length, reason = net.path((35, 5), (65, 5))
    assert cells is None and reason == "Crosses airfield pavement"
    print("baggage_links: all rule checks pass")
