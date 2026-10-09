# Draws the README's images, "How a change flows" and "When it runs", each in a
# light and a dark version, in one shared style.
# Edit the cards below, then run:  python3 .github/readme/make_images.py .github/readme
# The numbers they show (tries per run, failed runs before parking, schedules) are
# copied from agents/devs.mjs and the workflow crons; change them there first.

import sys

THEMES = {
    "light": dict(bg="#f7f8fb", card="#ffffff", border="#e3e7ee", text="#1b1f24", muted="#5b6472",
                  line="#a3acb9", group="#3fb950", groupFill="0.05", glow="0.16", shadow="#1b1f24", shadowOpacity="0.07"),
    "dark": dict(bg="#0b0e14", card="#141922", border="#262d38", text="#eef2f7", muted="#97a1ae",
                 line="#58616d", group="#3fb950", groupFill="0.06", glow="0.22", shadow="#000000", shadowOpacity="0.45"),
}

# Line icons on a 24-unit grid, drawn in the role's colour.
ICONS = {
    "issues": '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
    "owner": '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4 2.5 4H6"/>',
    "manager": '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17"/>',
    "live": '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 8.2v7.6"/><path d="M6 8.2c0 3.8 4 3.8 9.8 3.8"/>',
    "tester": '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    "lead": '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
    "parked": '<path d="M9.5 6v12M14.5 6v12"/>',
    "devs": '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    "health": '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
    "update": '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4.5V9h-4.5"/>',
}

def icon_chip(x, y, accent, name, size=28):
    scale = 0.667 * size / 28
    inset = 6 * size / 28
    return (f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{8*size/28}" fill="{accent}" fill-opacity="0.14"/>'
            f'<g transform="translate({x+inset} {y+inset}) scale({scale})" fill="none" stroke="{accent}" stroke-width="2.2" '
            f'stroke-linecap="round" stroke-linejoin="round" color="{accent}">{ICONS[name]}</g>')
ACCENT = dict(issues="#8b949e", owner="#a371f7", manager="#4493f8", devs="#3fb950",
              live="#d29922", tester="#db61a2", lead="#2fb5a8", parked="#f0883e",
              health="#39c5cf", update="#8b949e")

FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

def card(t, x, y, w, h, accent, icon, title, lines, tag=None):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{t["card"]}" stroke="{t["border"]}" filter="url(#shadow)"/>',
           icon_chip(x + 16, y + 14, accent, icon),
           f'<text x="{x+54}" y="{y+33}" font-size="16" font-weight="650" fill="{t["text"]}">{title}</text>']
    for i, line in enumerate(lines):
        out.append(f'<text x="{x+18}" y="{y+64+i*18}" font-size="12.5" fill="{t["muted"]}">{line}</text>')
    if tag:
        tw = 9 + len(tag) * 6.4
        # A badge sitting on the card's top edge, so it never competes with the title.
        out.append(f'<rect x="{x+w-tw-16}" y="{y-11}" width="{tw}" height="22" rx="11" fill="{accent}"/>')
        out.append(f'<text x="{x+w-16-tw/2}" y="{y+4}" font-size="11" font-weight="700" text-anchor="middle" fill="#ffffff">{tag}</text>')
    return "\n".join(out)

def step(t, x, y, w, h, number, title, lines):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{t["card"]}" stroke="{t["border"]}" filter="url(#shadow)"/>',
           f'<circle cx="{x+20}" cy="{y+22}" r="10" fill="{ACCENT["devs"]}" fill-opacity="0.18"/>',
           f'<text x="{x+20}" y="{y+26}" font-size="11" font-weight="700" text-anchor="middle" fill="{ACCENT["devs"]}">{number}</text>',
           f'<text x="{x+38}" y="{y+27}" font-size="15" font-weight="650" fill="{t["text"]}">{title}</text>']
    for i, line in enumerate(lines):
        out.append(f'<text x="{x+14}" y="{y+52+i*17}" font-size="12" fill="{t["muted"]}">{line}</text>')
    return "\n".join(out)

def pill(t, cx, cy, text, color):
    w = 16 + len(text) * 6.5
    return (f'<rect x="{cx-w/2}" y="{cy-11}" width="{w}" height="22" rx="11" fill="{t["bg"]}" stroke="{color}" stroke-opacity="0.55"/>'
            f'<text x="{cx}" y="{cy+4}" font-size="11.5" font-weight="600" text-anchor="middle" fill="{color}">{text}</text>')

def arrow(d, color, dashed=False, marker="arrow"):
    dash = ' stroke-dasharray="5 5"' if dashed else ""
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2"{dash} stroke-linecap="round" stroke-linejoin="round" marker-end="url(#{marker})"/>'

def canvas(t, width, height, title):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" font-family="{FONT}">',
             f'<title>{title}</title>',
             '<defs>']
    for marker, color in [("arrow", t["line"]), ("arrow-devs", ACCENT["devs"]), ("arrow-tester", ACCENT["tester"]),
                          ("arrow-parked", ACCENT["parked"]), ("arrow-owner", ACCENT["owner"])]:
        parts.append(f'<marker id="{marker}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                     f'<path d="M1 1 L9 5 L1 9 Z" fill="{color}"/></marker>')
    parts.append(f'<filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="{t["shadow"]}" flood-opacity="{t["shadowOpacity"]}"/></filter>')
    for glow, color in [("glow-a", ACCENT["owner"]), ("glow-b", ACCENT["manager"]), ("glow-c", ACCENT["devs"]), ("glow-d", ACCENT["tester"])]:
        parts.append(f'<radialGradient id="{glow}"><stop offset="0" stop-color="{color}" stop-opacity="{t["glow"]}"/><stop offset="1" stop-color="{color}" stop-opacity="0"/></radialGradient>')
    parts.append(f'<linearGradient id="group-border" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="{ACCENT["devs"]}"/><stop offset="1" stop-color="{ACCENT["lead"]}"/></linearGradient>')
    parts.append(f'<clipPath id="canvas"><rect width="{width}" height="{height}" rx="24"/></clipPath>')
    parts.append('</defs>')
    parts.append(f'<rect width="{width}" height="{height}" rx="24" fill="{t["bg"]}"/>')
    parts.append('<g clip-path="url(#canvas)">'
                 f'<ellipse cx="{width*0.14}" cy="{height*0.12}" rx="420" ry="260" fill="url(#glow-a)"/>'
                 f'<ellipse cx="{width*0.6}" cy="{height*0.42}" rx="520" ry="260" fill="url(#glow-c)"/>'
                 f'<ellipse cx="{width*0.92}" cy="{height*0.95}" rx="420" ry="240" fill="url(#glow-d)"/>'
                 f'<ellipse cx="{width*0.33}" cy="{height*0.85}" rx="380" ry="200" fill="url(#glow-b)"/>'
                 '</g>')
    return parts

# The flow was laid out under a title the README now carries itself; everything
# moves up by this much instead of being re-laid out.
FLOW_SHIFT = 62

def build_flow(name):
    t = THEMES[name]
    parts = canvas(t, 1280, 680 - FLOW_SHIFT, "How a change flows through selfgrow")
    parts.append(f'<g transform="translate(0 {-FLOW_SHIFT})">')
    # Product Owner, above the Product Manager.
    parts.append(card(t, 250, 104, 210, 92, ACCENT["owner"], "owner", "Product Owner", ["Vision and milestone"], "Mondays"))
    # Main row.
    parts.append(card(t, 40, 254, 170, 128, ACCENT["issues"], "issues", "Issues", ["filed by anyone: you,", "the Playtester,", "the Tech Lead"]))
    parts.append(card(t, 250, 254, 210, 128, ACCENT["manager"], "manager", "Product Manager", ["grooms every ticket:", "what the player gets,", "how to tell, priority"], "2× a day"))
    # Devs group.
    parts.append(f'<rect x="496" y="200" width="568" height="218" rx="20" fill="{t["group"]}" fill-opacity="{t["groupFill"]}" stroke="url(#group-border)" stroke-width="1.5"/>')
    parts.append(f'<text x="516" y="228" font-size="13" font-weight="700" letter-spacing="0.06em" fill="{ACCENT["devs"]}">DEVS</text>')
    parts.append(f'<text x="560" y="228" font-size="12.5" fill="{t["muted"]}">right after the PM, up to 6 tickets a run</text>')
    parts.append(step(t, 512, 272, 120, 102, 1, "Scout", ["plans one", "ticket"]))
    parts.append(step(t, 650, 272, 126, 102, 2, "Builder", ["writes it, guided", "by its skills"]))
    parts.append(step(t, 794, 272, 124, 102, 3, "Checks", ["syntax · lint · load", "selftest · tools"]))
    parts.append(step(t, 936, 272, 112, 102, 4, "Reviewer", ["other model,", "runs the page"]))
    parts.append(card(t, 1100, 254, 140, 128, ACCENT["live"], "live", "main", ["merged and", "live on the site"]))

    # Main arrows.
    parts.append(arrow("M210 318 L246 318", t["line"]))
    parts.append(arrow("M460 318 L492 318", t["line"]))
    parts.append(arrow("M632 323 L646 323", ACCENT["devs"], marker="arrow-devs"))
    parts.append(arrow("M776 323 L790 323", ACCENT["devs"], marker="arrow-devs"))
    parts.append(arrow("M918 323 L932 323", ACCENT["devs"], marker="arrow-devs"))
    parts.append(arrow("M1064 318 L1096 318", t["line"]))
    parts.append(arrow("M355 196 L355 250", ACCENT["owner"], marker="arrow-owner"))

    # Retry loops inside the Devs.
    parts.append(arrow("M856 272 C856 254, 713 254, 713 268", ACCENT["devs"], dashed=True, marker="arrow-devs"))
    parts.append(pill(t, 784, 258, "fails → fix", ACCENT["devs"]))
    parts.append(arrow("M992 374 C992 400, 713 400, 713 378", ACCENT["devs"], dashed=True, marker="arrow-devs"))
    parts.append(pill(t, 852, 398, "revise · up to 3 tries", ACCENT["devs"]))

    # What shipped, back to the Product Owner.
    parts.append(arrow("M1170 254 L1170 150 L464 150", ACCENT["owner"], dashed=True, marker="arrow-owner"))
    parts.append(pill(t, 820, 150, "what shipped", ACCENT["owner"]))

    # Parked → Tech Lead → Product Manager.
    parts.append(arrow("M713 418 L713 466", ACCENT["parked"], marker="arrow-parked"))
    parts.append(card(t, 600, 470, 226, 100, ACCENT["parked"], "parked", "Parked", ["after 2 failed runs,", "with a post-mortem"]))
    parts.append(arrow("M600 520 L564 520", ACCENT["parked"], marker="arrow-parked"))
    parts.append(card(t, 290, 470, 270, 100, ACCENT["lead"], "lead", "Tech Lead", ["reads the whole codebase,", "diagnoses what got parked"], "Thursdays"))
    parts.append(arrow("M410 470 L410 386", t["line"]))

    # Playtester and its findings.
    parts.append(arrow("M1135 382 L1135 466", ACCENT["tester"], marker="arrow-tester"))
    parts.append(card(t, 990, 470, 250, 100, ACCENT["tester"], "tester", "Playtester", ["plays the live site, judges", "it on desktop and phone"], "nightly"))
    parts.append(arrow("M1115 570 L1115 622 L125 622 L125 386", ACCENT["tester"], dashed=True, marker="arrow-tester"))
    parts.append(pill(t, 640, 622, "findings and verdicts", ACCENT["tester"]))

    parts.append(f'<text x="48" y="660" font-size="12" fill="{t["muted"]}">A change merges only when the checks pass and a Reviewer on a different model approves. Changes to the machine itself wait for a person.</text>')
    parts.append('</g>')
    parts.append('</svg>')
    return "\n".join(parts)

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# One row per time of day, as in the workflow crons. A daily job is one bar across
# the week; a weekly job is a card on its day.
SCHEDULE = [
    ("00:30", "daily", "manager", "manager", "Product Manager", "grooms the backlog", ("Sun", "+ digest")),
    ("07:00", "Tue", "update", "update", "pi-update", "runtime check", None),
    ("08:00", "Mon", "owner", "owner", "Product Owner", "Vision + milestone", None),
    ("09:00", "Thu", "lead", "lead", "Tech Lead", "codebase review", None),
    ("12:30", "daily", "manager", "manager", "Product Manager", "grooms the backlog", None),
    ("14:00", "daily", "devs", "devs", "Devs", "build what is left · also right after each PM run", None),
    ("16:00", "daily", "health", "health", "Health", "speaks only when something is broken", None),
    ("23:00", "daily", "tester", "tester", "Playtester", "plays the live site, findings ready for the PM", None),
]

def build_schedule(name):
    t = THEMES[name]
    width, left, top, row, gap = 1280, 128, 64, 58, 8
    column = (width - left - 40) / len(DAYS)
    height = top + row * len(SCHEDULE) + 64
    parts = canvas(t, width, height, "When each role of selfgrow runs, in UTC")
    for index, day in enumerate(DAYS):
        x = left + index * column
        weekend = day in ("Sat", "Sun")
        parts.append(f'<text x="{x + column / 2}" y="{top - 22}" font-size="13" font-weight="700" letter-spacing="0.06em" '
                     f'text-anchor="middle" fill="{t["muted"] if weekend else t["text"]}">{day.upper()}</text>')
        if index:
            parts.append(f'<path d="M{x} {top - 8} L{x} {top + row * len(SCHEDULE)}" stroke="{t["border"]}" stroke-dasharray="3 5"/>')
    for index, (time, when, accent_key, icon_name, title, note, extra) in enumerate(SCHEDULE):
        y = top + index * row
        accent = ACCENT[accent_key]
        parts.append(f'<text x="40" y="{y + row / 2 + 5}" font-size="14" font-weight="650" fill="{t["muted"]}" '
                     f'font-variant-numeric="tabular-nums">{time}</text>')
        if when == "daily":
            x, w = left + gap, column * len(DAYS) - gap * 2
        else:
            x, w = left + DAYS.index(when) * column + gap, column - gap * 2
        h = row - gap * 2 + 4
        box_y = y + gap - 2
        parts.append(f'<rect x="{x}" y="{box_y}" width="{w}" height="{h}" rx="12" fill="{t["card"]}" stroke="{t["border"]}" filter="url(#shadow)"/>')
        parts.append(f'<rect x="{x}" y="{box_y}" width="{w}" height="{h}" rx="12" fill="{accent}" fill-opacity="0.07"/>')
        parts.append(icon_chip(x + 8, box_y + (h - 24) / 2, accent, icon_name, size=24))
        # A weekly card is one day wide, so its title is set a step smaller to fit.
        title_size = 14 if when == "daily" else 13
        parts.append(f'<text x="{x + 40}" y="{box_y + h / 2 + 5}" font-size="{title_size}" font-weight="650" fill="{t["text"]}">{title}</text>')
        if when == "daily":
            parts.append(f'<text x="{x + 186}" y="{box_y + h / 2 + 5}" font-size="12.5" fill="{t["muted"]}">{note}</text>')
            parts.append(f'<text x="{x + w - 14}" y="{box_y + h / 2 + 4}" font-size="11" font-weight="650" text-anchor="end" fill="{accent}">every day</text>')
        if extra:
            day, label = extra
            tw = 12 + len(label) * 6.4
            cx = left + DAYS.index(day) * column + column / 2
            parts.append(f'<rect x="{cx - tw / 2}" y="{box_y - 9}" width="{tw}" height="20" rx="10" fill="{accent}"/>')
            parts.append(f'<text x="{cx}" y="{box_y + 5}" font-size="11" font-weight="700" text-anchor="middle" fill="#ffffff">{label}</text>')
    parts.append(f'<text x="40" y="{height - 26}" font-size="12" fill="{t["muted"]}">All times UTC. review-pr and triage-fork-pr run on every pull request; reset only when started by hand.</text>')
    parts.append('</svg>')
    return "\n".join(parts)

out = sys.argv[1]
for name in THEMES:
    with open(f"{out}/flow-{name}.svg", "w") as handle:
        handle.write(build_flow(name))
    with open(f"{out}/schedule-{name}.svg", "w") as handle:
        handle.write(build_schedule(name))
