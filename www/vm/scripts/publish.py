#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path


def publish() -> None:
    # Direct page dependencies use stable URLs; lazy chunks retain content names.
    Path("dist").mkdir(exist_ok=True)
    files = sorted(path for path in Path("build/ui").iterdir() if path.is_file() and path.name != ".built")
    if Path("build/ui/app.js") not in files:
        raise ValueError("expected one application entry bundle")
    for path in files:
        shutil.copyfile(path, Path("dist") / path.name)
    for name in ("style.css", "favicon.svg"):
        shutil.copyfile(name, Path("dist") / name)
    replacements = {"app": "dist/app.js", "style": "dist/style.css", "favicon": "dist/favicon.svg"}

    # Check the complete page before replacing the live entry or its dependency list.
    page = Path("index.template.html").read_text(encoding="utf-8")
    for key, value in replacements.items():
        page = page.replace("{{" + key + "}}", value)
    if "{{" in page:
        raise ValueError("unresolved entry-page placeholder")
    outputs = [f"dist/{path.name}" for path in files]
    outputs.extend((replacements["style"], replacements["favicon"]))

    # Record the VM assets embedded in this bundle, independently of later builds.
    active = list(outputs)
    images = json.loads(Path("vm/build/assets.json").read_text(encoding="utf-8"))
    for image in images.values():
        configuration = Path(image["configUrl"])
        config = json.loads(configuration.read_text(encoding="utf-8"))
        active.append(configuration.as_posix())
        active.append((configuration.parent / config["drive0"]["file"]).parent.as_posix())
        active.append(Path(image["runtimeUrl"]).parent.as_posix())
    inventory = json.dumps(sorted(set(active)), indent=2) + "\n"
    Path("build/published-outputs.mk").write_text(
        f"PUBLISHED_OUTPUTS := {' '.join(outputs)}\n"
        "index.html: $(PUBLISHED_OUTPUTS)\n$(PUBLISHED_OUTPUTS):\n",
        encoding="utf-8",
    )

    # Publish the entry only after every referenced asset is available.
    entry = Path("index.html")
    if not entry.exists() or entry.read_text(encoding="utf-8") != page:
        temporary = Path("index.html.part")
        temporary.write_text(page, encoding="utf-8")
        temporary.replace(entry)
    temporary = Path(".published-assets.json.part")
    temporary.write_text(inventory, encoding="utf-8")
    temporary.replace(".published-assets.json")


def main() -> int:
    try:
        publish()
    except (OSError, ValueError) as error:
        print(f"VM client publication: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
