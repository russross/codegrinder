#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import shutil
import sys
from pathlib import Path


def asset(path: Path, stem: str, extension: str) -> str:
    """Publish immutable bytes and return their relative deployment path."""
    content = path.read_bytes()
    digest = hashlib.sha256(content).hexdigest()[:16]
    destination = Path("dist") / f"{stem}-{digest}.{extension}"
    destination.write_bytes(content)
    return destination.as_posix()


def publish() -> None:
    # Content names keep every cached entry linked to its original asset bytes.
    Path("dist").mkdir(exist_ok=True)
    files = sorted(path for path in Path("build/ui").iterdir() if path.is_file() and path.name != ".built")
    scripts = [path for path in files if path.name.startswith("app-") and path.suffix == ".js"]
    if len(scripts) != 1:
        raise ValueError("expected one application entry bundle")
    for path in files:
        shutil.copyfile(path, Path("dist") / path.name)
    replacements = {
        "app": f"dist/{scripts[0].name}",
        "style": asset(Path("style.css"), "style", "css"),
        "favicon": asset(Path("favicon.svg"), "favicon", "svg"),
    }

    # Check the complete page before replacing the live entry or its dependency list.
    page = Path("index.template.html").read_text(encoding="utf-8")
    for key, value in replacements.items():
        page = page.replace("{{" + key + "}}", value)
    if "{{" in page:
        raise ValueError("unresolved entry-page placeholder")
    outputs = [f"dist/{path.name}" for path in files]
    outputs.extend((replacements["style"], replacements["favicon"]))
    Path("build/published-outputs.mk").write_text(
        f"PUBLISHED_OUTPUTS := {' '.join(outputs)}\n"
        "index.html: $(PUBLISHED_OUTPUTS)\n$(PUBLISHED_OUTPUTS):\n",
        encoding="utf-8",
    )

    # Publish the entry only after every referenced asset is available.
    temporary = Path("index.html.part")
    temporary.write_text(page, encoding="utf-8")
    temporary.replace("index.html")


def main() -> int:
    try:
        publish()
    except (OSError, ValueError) as error:
        print(f"Exam publication: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
