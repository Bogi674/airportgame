"""Surface texture patterns in meters: dirt, gravel, grass, asphalt, aged asphalt, concrete."""
import random
from lib import *


def specks(w, h, n, cols, rmin, rmax, seed):
    r = random.Random(seed)
    o = []
    for _ in range(n):
        o.append(circle(r.uniform(0, w), r.uniform(0, h), r.uniform(rmin, rmax), r.choice(cols)))
    return "".join(o)


def pat(pid, w, h, content):
    return f'<pattern id="{pid}" patternUnits="userSpaceOnUse" width="{w}" height="{h}">{content}</pattern>'


def surface_defs():
    d = []
    d.append(pat("pDirt", 4, 4, rect(0, 0, 4, 4, "#9c7650") + specks(4, 4, 90, ["#8a6744", "#b08a60", "#7d5c3c", "#a98458"], 0.03, 0.09, 1)))
    d.append(pat("pGrav", 3, 3, rect(0, 0, 3, 3, "#a9a49b") + specks(3, 3, 260, ["#8f8a82", "#c4bfb5", "#7b776f", "#d6d1c7", "#9e998f"], 0.03, 0.08, 2)))
    grass = rect(0, 0, 12, 12, "#6b9a4c") + rect(0, 0, 6, 12, "#74a455")
    r = random.Random(3)
    for _ in range(220):
        x, y = r.uniform(0, 12), r.uniform(0, 12)
        grass += line(x, y, x + r.uniform(-0.05, 0.05), y - r.uniform(0.12, 0.25), r.choice(["#5d8a42", "#82b062", "#4f7a37"]), 0.03)
    d.append(pat("pGrass", 12, 12, grass))
    d.append(pat("pAsph", 4, 4, rect(0, 0, 4, 4, "#4b5058") + specks(4, 4, 160, ["#565b63", "#43474e", "#5f646c"], 0.02, 0.05, 4)))
    aged = rect(0, 0, 16, 16, "#555a61") + specks(16, 16, 900, ["#60656c", "#4c5057", "#6a6f76"], 0.02, 0.06, 5)
    aged += rect(3, 9, 5, 3.2, "#3f4349", op=0.85) + rect(10.5, 2, 3.5, 2.5, "#41454b", op=0.85)
    aged += path("M0,5 Q4,4.4 7,6 T16,5.5", "none", "#2f3338", 0.07) + path("M9,16 Q9.6,12 12,10 T13,0", "none", "#2f3338", 0.06)
    d.append(pat("pAsphAged", 16, 16, aged))
    conc = ""
    tones = ["#bcc0c3", "#b4b8bc", "#c0c3c6", "#b7bbbf"]
    for i in range(2):
        for j in range(2):
            conc += rect(i * 5, j * 5, 5, 5, tones[i * 2 + j])
    conc += specks(10, 10, 160, ["#a9adb1", "#c9cccf"], 0.02, 0.05, 6)
    conc += line(0, 0, 10, 0, "#8f9499", 0.09) + line(0, 5, 10, 5, "#8f9499", 0.09)
    conc += line(0, 0, 0, 10, "#8f9499", 0.09) + line(5, 0, 5, 10, "#8f9499", 0.09)
    d.append(pat("pConc", 10, 10, conc))
    return "".join(d)
