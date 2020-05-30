CodeGrinder is a tool that hosts programming exercises for students.
Problems are graded using unit tests, and scores are posted back to
an LMS such as Canvas using the LTI protocol.


Project status
==============

This is a tool we use internally at Dixie State University in our
Computer Science program. It is pretty stable and we have been using
it for years, but it is mostly an internal project. I recommend
getting in touch if you would like to use it.

CodeGrinder is released under the terms of the AGPL. If you would
like to use it and these terms are not suitable, please contact the
author to inquire about alternate licensing.


What is here
============

This repository currently hosts two tools:

1.  The CodeGrinder server. This is further divided into two parts,
    which can run as part of the same service, or can be hosted on
    separate servers. A CodeGrinder installation needs exactly one
    TA service and one or more daycare services.

    1.  The TA service: this manages bookkeeping and runs on top of
        SQLite 3. It interfaces with an LMS by acting as an LTI
        tool provider. An LMS such as Canvas hosts an assignment
        page, and directs students to the TA service complete with
        basic credentials, login information, and information about
        the problem set that was assigned. The TA then acts as an
        API server for basic bookkeeping tasks.

    2.  The daycare service: this runs student code with
        problem-specific unit tests in Docker containers, streams
        the results back to the client in real time, and returns a
        report card with the results.

2.  The grind command-line tool. This provides a command-line user
    intereface for students, instructors, and problem authors.
    Students can see their currently-assigned problems, pull them
    onto their local machines, and submit them for grading.


Installation
============

All instructions here assume a Debian Buster or Ubuntu Server 20.04
server environment.


### Install prerequisites

Install a few basic tools:

    sudo apt install build-essential golang git sqlite3

The host must have port 443 open to serve the API over https, and it
must also have port 80 open so LetsEncrypt can issue certificates.

### Install CodeGrinder

Fetch the CodeGrinder repository:

    cd
    git clone https://github.com/russross/codegrinder.git
    cd codegrinder

The rest of these instructions assume you are in the project root
directory.

Build and install CodeGrinder. For a TA node, use:

    ./all.sh

This builds `codegrinder` (the server) and installs it in
`/usr/local/bin`. It also builds the `grind` tool for several
architectures and puts them in the `www` directory for users to
download.

For a daycare node that is not also a TA node, use:

    ./build.sh

This only builds and installs the server. Both of these scripts
also give the `codegrinder` binary the capability to bind to
low-numbered ports, so CodeGrinder does not need any other special
privileges to run. It should NOT be run as root.


### Setup database (TA node only)

Run the database setup script. Warning: this will delete an existing
installation, so use this with caution.

    ./setup/setup-database.sh


### Install Docker (daycare nodes only)

Install and configure Docker, and add your CodeGrinder user to the
`docker` group so it can manage containers without being root. Note
that you only need this on daycare nodes:

    sudo apt install docker.io
    sudo usermod -aG docker $USER


### Configure CodeGrinder

Next, create a config file that is customized for your installation.
It should be saved as `~/codegrinder/config.json` and its contents
depend on what role this node will take. All nodes should contain
the following:

    {
        "hostname": "your.domain.name",
        "daycareSecret": "",
    }

Put in your domain name to use when registering TLS certificates
with LetsEncrypt.

For the node running the TA role, you should add these keys:

        "ltiSecret": "",
        "sessionSecret": "",

and for nodes running the daycare role, you should add these keys:

        "taHostname": "your.ta.domain.name",
        "capacity": 1,
        "problemTypes": [
            "python3unittest"
        ],

making sure to list all of the problem types this daycare will
process.

Note that this is a JSON file, so every entry should have a trailing
comma except for the last one, which must *not* end with a comma.

For the secrets, generate each one using:

    head -c 32 /dev/urandom | base64

Run that command once and copy the output into the `ltiSecret`, then
run it again and copy the output to `sessionSecret`, then run it a
third time and copy the output to `daycareSecret`. The
`daycareSecret` value must be shared by all nodes.

Note that there are other settings available that allow you to
customize the installation, but they are not documented here. If you
need them, check out the `Config` type defined in
`codegrinder/server.go`. The fields of that struct are the fields of
the config file.

For daycare nodes, you must also build the Docker images that will
host the student code:

    make -C ./containers amd64

Or if you are running on a Raspberry Pi and need the ARM64 images:

    make -C ./containers arm64

At this point, you should be able to run the server. To run it with
only the TA service, use:

    codegrinder -ta

If you want a daycare running on the same node, use:

    codegrinder -ta -daycare

Leave it running in a terminal so you can watch the log output.

For normal use, you will want systemd to manage it:

    sudo cp ./setup/codegrinder.service /lib/systemd/system/

Then edit the file you have copied to customize it. In particular,
set the options in the executable to run as -ta, -daycare, or both,
and in the dependencies section comment out the docker dependency
if this is not a daycare node.

To start it, use:

    sudo systemctl start codegrinder

To set it to automatically start at system boot:

    sudo systemctl enable codegrinder

To stop it:

    sudo systemctl stop codegrinder

To check if it is running and see the most recent log messages:

    sudo systemctl status codegrinder

To review the logs:

    sudo journalctl -xeu codegrinder

To follow the logs in real time:

    sudo journalctl -xfu codegrinder

There is also a script in the setup directory to take daily backups
of the database. Create a directory to hold the daily backups and
set the script to run daily using cron:

    mkdir -p ~/backup
    crontab -e

Then add a line like this to the end of the file:

    7 5 * * * /home/russ/codegrinder/setup/backup-codegrinder-database

with the directory set to match your installation location. This
will create a daily snapshot of the database in `~/backup`. You
should probably copy this to a different machine on a regular basis
and also clear out old backups periodically.


License
=======

CodeGrinder is licenced under the AGPL. I am willing to consider
re-licensing CodeGrinder under a more permissive license, depending
on the use case. Please contact me if you wish to discuss this.


CodeGrinder programming exercise system
Copyright © 2016–2020  Russ Ross

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <http://www.gnu.org/licenses/>.
