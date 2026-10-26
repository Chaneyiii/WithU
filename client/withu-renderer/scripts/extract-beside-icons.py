#!/usr/bin/env python3
"""Extract the Beside icon family from the user-supplied reference video frames.

Source video (user-supplied, 2026-10-20):
  https://cdn.collectui.com/amplify_video/2109709222371868672/vid/avc1/1920x1080/00HHPdmozwqU9WX_-optimized.mp4
  designer page: https://collectui.com/designers/_eugrl
  1920x1080, 60fps, 15s. Round organic black outlines on white.

The video and its extracted frames are NOT committed (they live under output/,
which is git-ignored). Only the transparent currentColor masks produced by this
script are committed, together with this script and beside-icons.json, so every
asset can be traced back to an exact frame and crop rectangle.

Usage:
  python scripts/extract-beside-icons.py [--frames DIR] [--out DIR] [--dry-run]

Frames default to ../../output/phase1-references relative to this script
(the worktree output directory created during Phase 1 reference collection).
Each entry below was chosen from connected-component analysis of the frame;
boxes are (x0, y0, x1, y1) inclusive, in frame pixels.
"""
import argparse
import json
import os
import sys
from datetime import date

from PIL import Image

SOURCE_VIDEO_URL = (
    "https://cdn.collectui.com/amplify_video/2109709222371868672/vid/avc1/"
    "1920x1080/00HHPdmozwqU9WX_-optimized.mp4"
)
SOURCE_DESIGNER_URL = "https://collectui.com/designers/_eugrl"

# name -> (frame file, box (x0,y0,x1,y1), frame time, note)
# Frame times are the timestamps labeled by the frame extraction pass (0.5s steps).
ICONS = {
    # --- frame icons-4.5s.png (4.5s): large, well separated glyphs ---
    "chat":     ("icons-4.5s.png", (559, 274, 717, 431), "4.5s", "speech bubble"),
    "ideas":    ("icons-4.5s.png", (800, 193, 921, 357), "4.5s", "lightbulb"),
    "camera":   ("icons-4.5s.png", (1107, 268, 1265, 405), "4.5s", "camera body incl. lens"),
    "calendar": ("icons-4.5s.png", (343, 419, 495, 571), "4.5s", "calendar"),
    "inbox":    ("icons-4.5s.png", (901, 403, 1049, 552), "4.5s", "inbox tray"),
    "bell":     ("icons-4.5s.png", (1273, 499, 1409, 656), "4.5s", "notification bell"),
    "heart":    ("icons-4.5s.png", (515, 636, 672, 781), "4.5s", "heart"),
    "mail":     ("icons-4.5s.png", (777, 652, 944, 793), "4.5s", "envelope"),
    "palette":  ("icons-4.5s.png", (1034, 626, 1192, 774), "4.5s", "artist palette"),
    "mic":      ("icons-4.5s.png", (1433, 697, 1533, 834), "4.5s", "microphone (head + stand)"),
    # --- frame icons-7s.png (7s): medium glyphs, broader inventory ---
    "search":    ("icons-7s.png", (1651, 729, 1724, 791), "7s", "magnifier"),
    "library":   ("icons-7s.png", (356, 159, 444, 247), "7s", "grid of four rounded squares"),
    "folder":    ("icons-7s.png", (1723, 889, 1819, 969), "7s", "folder"),
    "phone":     ("icons-7s.png", (105, 568, 205, 638), "7s", "phone handset"),
    "headphones": ("icons-7s.png", (281, 554, 364, 638), "7s", "headphones"),
    "globe":     ("icons-7s.png", (1518, 128, 1606, 216), "7s", "globe"),
    "plane":     ("icons-7s.png", (483, 318, 568, 411), "7s", "paper plane"),
    "cloud":     ("icons-7s.png", (515, 658, 624, 743), "7s", "cloud"),
    "chart":     ("icons-7s.png", (92, 374, 190, 449), "7s", "line chart"),
    "wand":      ("icons-7s.png", (263, 404, 352, 467), "7s", "sparkle wand"),
    "smiley":    ("icons-7s.png", (1006, 681, 1110, 785), "7s", "smiley face"),
    "hand":      ("icons-7s.png", (1521, 513, 1600, 597), "7s", "open hand (stop)"),
    # --- frame icons-8s.png (8s): small glyphs ---
    "settings":  ("icons-8s.png", (438, 955, 485, 1002), "8s", "gear"),
    "goals":     ("icons-8s.png", (1624, 654, 1716, 722), "8s", "target with arrow"),
    "pin":       ("icons-8s.png", (1517, 870, 1564, 935), "8s", "push pin"),
    "pencil":    ("icons-8s.png", (1237, 107, 1285, 175), "8s", "pencil"),
    "check":     ("icons-8s.png", (953, 887, 1015, 949), "8s", "checkmark in circle"),
    "document":  ("icons-8s.png", (719, 130, 787, 198), "8s", "document"),
    "book":      ("icons-8s.png", (210, 489, 286, 554), "8s", "open book"),
    "briefcase": ("icons-8s.png", (439, 129, 509, 196), "8s", "briefcase"),
    "person":    ("icons-8s.png", (1655, 872, 1720, 955), "8s", "person with plus"),
    # --- frame icons-9s.png (9s): smallest usable glyphs ---
    "clock":     ("icons-9s.png", (1622, 89, 1670, 137), "9s", "clock"),
    "trash":     ("icons-9s.png", (1529, 825, 1571, 874), "9s", "trash can"),
    "copy":      ("icons-9s.png", (163, 138, 204, 181), "9s", "two overlapping documents"),
    "flag":      ("icons-9s.png", (1082, 927, 1116, 966), "9s", "flag"),
    "link":      ("icons-9s.png", (751, 948, 791, 986), "9s", "chain link"),
    "monitor":   ("icons-9s.png", (1451, 924, 1490, 972), "9s", "display screen"),
    "image":     ("icons-9s.png", (1558, 908, 1607, 957), "9s", "picture"),
    "video":     ("icons-9s.png", (1633, 176, 1686, 217), "9s", "video camera"),
    "question":  ("icons-9s.png", (1405, 399, 1452, 445), "9s", "question mark in circle"),
    "lock":      ("icons-9s.png", (156, 322, 196, 363), "9s", "padlock"),
    "faceid":    ("icons-9s.png", (261, 316, 301, 365), "9s", "face id"),
    "laptop":    ("icons-9s.png", (777, 230, 827, 280), "9s", "laptop"),
}

# Glyphs deliberately NOT extracted because the video contains no usable
# original for them. These slots keep the previous app icons and are recorded
# as coverage gaps in beside-icons.json / the task report.
GAPS = [
    "close", "chevron", "down", "more", "plus", "send", "back", "forward",
    "external", "sidebar", "sort", "folderOpen", "sun", "moon", "speaker",
    "speakerMuted", "legal", "stop", "podcast", "reply", "share", "archive",
    "database", "gauge", "reset", "feed", "activity", "menu", "panel",
]

PAD = 8           # pixels of white margin kept around each glyph
THRESHOLD = 200   # luminance below which a pixel counts as ink
MAX_SIZE = 128    # normalized longest edge of the emitted mask


def extract(frames_dir, out_dir, dry_run=False):
    manifest = {
        "source": {
            "video": SOURCE_VIDEO_URL,
            "designer": SOURCE_DESIGNER_URL,
            "note": (
                "Beside icon family shown in the user-supplied reference video. "
                "Frames extracted at 0.5s steps; boxes are inclusive pixel "
                "rectangles in the 1920x1080 frame."
            ),
        },
        "extracted": date.today().isoformat(),
        "masks": {},
        "gaps": GAPS,
    }
    missing = []
    for name, (frame, box, when, note) in sorted(ICONS.items()):
        src = os.path.join(frames_dir, frame)
        if not os.path.exists(src):
            missing.append((name, src))
            continue
        im = Image.open(src).convert("RGBA")
        x0, y0, x1, y1 = box
        x0 = max(0, x0 - PAD)
        y0 = max(0, y0 - PAD)
        x1 = min(im.width - 1, x1 + PAD)
        y1 = min(im.height - 1, y1 + PAD)
        crop = im.crop((x0, y0, x1 + 1, y1 + 1))
        px = crop.load()
        w, h = crop.size
        for j in range(h):
            for i in range(w):
                r, g, b, _a = px[i, j]
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                if lum >= THRESHOLD:
                    px[i, j] = (0, 0, 0, 0)
                else:
                    alpha = max(40, int((THRESHOLD - lum) / THRESHOLD * 255))
                    px[i, j] = (17, 17, 18, alpha)
        if max(w, h) > MAX_SIZE:
            scale = MAX_SIZE / max(w, h)
            crop = crop.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS
            )
        if not dry_run:
            os.makedirs(out_dir, exist_ok=True)
            crop.save(os.path.join(out_dir, name + ".png"))
        manifest["masks"][name] = {
            "frame": frame,
            "frameTime": when,
            "box": [box[0], box[1], box[2], box[3]],
            "note": note,
            "size": [crop.width, crop.height],
        }
    if missing:
        for name, src in missing:
            print("MISSING FRAME for %s: %s" % (name, src), file=sys.stderr)
        raise SystemExit(1)
    if not dry_run:
        with open(os.path.join(out_dir, "beside-icons.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
    print("extracted %d masks (+%d gaps) -> %s" % (
        len(manifest["masks"]), len(GAPS), out_dir))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--frames",
        default=os.path.normpath(os.path.join(here, "..", "..", "..", "output", "phase1-references")),
        help="directory containing the extracted video frames",
    )
    parser.add_argument(
        "--out",
        default=os.path.normpath(os.path.join(here, "..", "src", "assets", "beside-icons")),
        help="output directory for the transparent masks",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    extract(args.frames, args.out, args.dry_run)


if __name__ == "__main__":
    main()
