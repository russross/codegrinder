#!/usr/bin/env python3
"""Publish legacy browser assets without exposing source or build dependencies."""
from pathlib import Path
import shutil
import sys


def publish() -> None:
    destination = Path('../../dist/web')
    destination.mkdir(parents=True, exist_ok=True)
    static = [Path(name) for name in ('index.html', 'styles.css', 'favicon.svg', 'local-runtimes.json', 'LICENSE')]
    bundles = sorted(path for path in Path('scripts').iterdir()
                     if path.suffix in ('.js', '.wasm') or path.name.endswith('.LICENSE.txt'))
    files = [*static, *bundles, *Path('.').glob('sw.js*')]

    # Compare bytes so an unchanged deployment retains its timestamps.
    for source in files:
        target = destination / source
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.read_bytes() != source.read_bytes():
            temporary = target.with_name(target.name + '.part')
            shutil.copyfile(source, temporary)
            temporary.replace(target)
    outputs = ' '.join(str(destination / path) for path in files)
    Path('build/published-outputs.mk').write_text(
        f'LEGACY_OUTPUTS := {outputs}\n'
        'build/.published: $(LEGACY_OUTPUTS)\n$(LEGACY_OUTPUTS):\n')
    Path('build/.published').touch()


if __name__ == '__main__':
    try:
        publish()
    except (OSError, ValueError) as error:
        sys.exit(f'legacy web publication: {error}')
