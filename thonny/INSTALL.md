Thonny plugin
=============

This is the Thonny plugin to integrate with CodeGrinder.

To publish a new version:

1.  Get the current version from `../types/version.go` and set it in:
    * `pyproject.toml`
    * `thonnycontrib/thonny_codegrinder_plugin/__init__.py`

2.  Clear out the old release files:

        rm -rf build dist thonny_codegrinder_plugin.egg-info 

2.  Build a release using:

        uv build

3.  Upload the distribution files to the public index:

        uv run python3 -m twine upload dist/*
