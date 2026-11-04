# Reference geometry (Python)

Normative geometry for DESIGN_REVISION_2.md. Port to TypeScript, do not ship.

* lib.py: view transform, SVG helpers, aircraft planform builder
* netdraw.py: fillet(), junction(), bend()
* fig1.py: stand lead in fork
* fig4_stand_data.py: aircraft outlines, nose gaps, Small stand (running it also renders the first round sheet)
* fig5.py: contact stand markings, funnel search
* fig6.py: junction2() with shoulders, markings and surfaces
* fig7.py: apron modes and terminal size

Paths inside point to a scratch folder, change them to run. Needs python3, shapely, rsvg-convert for PNG.
