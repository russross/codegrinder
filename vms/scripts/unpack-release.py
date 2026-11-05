#!/usr/bin/env python3
"""Restore a cached release tree only when an archive member is missing."""
import shutil
import sys
import tarfile
from pathlib import Path


def unpack(archive: Path, destination: Path) -> None:
    # Releases have one enclosing directory; deployed payload names stay intact.
    with tarfile.open(archive) as source:
        members = source.getmembers()
        for member in members:
            member.name = '/'.join(Path(member.name).parts[1:])
        members = [member for member in members if member.name]
        if all((destination / member.name).exists() for member in members):
            return
        temporary = destination.with_name(destination.name + '.part')
        shutil.rmtree(temporary, ignore_errors=True)
        temporary.mkdir(parents=True)
        source.extractall(temporary, members=members, filter='data')
    shutil.rmtree(destination, ignore_errors=True)
    temporary.replace(destination)


if __name__ == '__main__':
    try:
        unpack(Path(sys.argv[1]), Path(sys.argv[2]))
    except (OSError, ValueError, tarfile.TarError) as error:
        sys.exit(f'release extraction: {error}')
