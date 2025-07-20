from setuptools import setup

setup (
        name="thonny-codegrinder-plugin",
        version="2.7.0",
        description="Thonny plugin to integrate with CodeGrinder for coding practice",
        long_description="""Thonny plugin to integrate with CodeGrinder.
    This is for students enrolled in Python programming classes
    that use CodeGrinder for automatic testing and grading.""",
        url="https://github.com/russross/codegrinder/",
        author="Russ Ross",
        author_email="russ@russross.com",
        license="AGPL",
        classifiers=[
            "Intended Audience :: Education",
            "Intended Audience :: End Users/Desktop",
            "License :: OSI Approved :: GNU Affero General Public License v3",
            "Operating System :: OS Independent",
            "Programming Language :: Python :: 3",
            "Topic :: Education",
        ],
        keywords="Thonny CodeGrinder eduction",
        platforms=["Windows", "macOS", "Linux"],
        python_requires=">=3.6",
        install_requires = [
            "requests >=2.25.1",
            "thonny >=3.0",
            "websocket-client >=1.2.1",
            "Pillow >=8.3.1",
            "dataclasses-json >=0.5.4",
            "typing-extensions >=3.10",
            "certifi >=2021.10.8",
        ],
        packages=[
            'thonnycontrib.thonny_codegrinder_plugin',
            'thonnycontrib.thonny_codegrinder_plugin.tkhtmlview',
        ],
)
