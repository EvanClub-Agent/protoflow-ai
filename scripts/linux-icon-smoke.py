"""Check the actual DEB's desktop icon through GTK, without installing the app.

Run on Debian/Ubuntu with python3-gi, gir1.2-gtk-3.0, hicolor-icon-theme and
desktop-file-utils installed. No graphical session or user profile is required.
"""
import argparse
import configparser
from pathlib import Path
import subprocess
import tempfile

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk


def check(package, expect_missing=False):
    with tempfile.TemporaryDirectory(prefix="protoflow-icon-check-") as directory:
        root = Path(directory)
        subprocess.run(["dpkg-deb", "--extract", str(package), str(root)], check=True)
        desktop = root / "usr/share/applications/protoflow-ai.desktop"
        subprocess.run(["desktop-file-validate", str(desktop)], check=True)
        entry = configparser.ConfigParser(interpolation=None)
        entry.optionxform = str
        entry.read(desktop)
        icon_name = entry["Desktop Entry"]["Icon"]
        assert entry["Desktop Entry"]["StartupWMClass"] == "protoflow-ai"
        assert icon_name == "protoflow-ai", "Desktop entry must use the installed icon name"

        theme = Gtk.IconTheme.new()
        # Use the DEB's icons and the distribution's real hicolor index.theme.
        # This catches icons copied into sizes that the desktop cannot discover.
        theme.set_search_path([str(root / "usr/share/icons"), "/usr/share/icons"])
        theme.set_custom_theme("hicolor")
        if expect_missing:
            assert theme.lookup_icon(icon_name, 48, 0) is None, "Previous package no longer reproduces the missing icon"
            print("PASS reproduced missing 48px desktop icon in previous package", flush=True)
            return

        for size in (16, 24, 32, 48, 64, 128, 256, 512):
            info = theme.lookup_icon(icon_name, size, Gtk.IconLookupFlags.FORCE_SIZE)
            assert info is not None, f"Desktop cannot find {icon_name} at {size}px"
            assert Path(info.get_filename()).is_relative_to(root), "Icon must come from this DEB"
            pixels = info.load_icon()
            assert (pixels.get_width(), pixels.get_height()) == (size, size)
        print("PASS DEB desktop icon resolves and decodes at 16–512px through GTK", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("--previous-package", type=Path)
    args = parser.parse_args()
    if args.previous_package:
        check(args.previous_package.resolve(), expect_missing=True)
    check(args.package.resolve())
