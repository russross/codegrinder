Thonny plugin
=============

This is the Thonny plugin to integrate with CodeGrinder.

To publish a new version:

1.  Get the current version from `../types/version.go` and set it in:
    * `setup.py`
    * `thonnycontrib/thonny_codegrinder_plugin/__init__.py`

2.  Clear out the old release files:

        rm -rf build dist thonny_codegrinder_plugin.egg-info 

2.  Build a release using:

        python3 setup.py sdist bdist_wheel

3.  Upload the distribution files to the public index:

        python3 -m twine upload dist/*
