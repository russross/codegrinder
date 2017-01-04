CodeGrinder is a tool that hosts programming exercises for students.
Problems are graded using unit tests, and scores are posted back to
an LMS such as Canvas using the LTI protocol.


Project status
==============

This is a rewrite of a tool we use internally at Dixie State
University in our Computer Science program. This is a work in
progress, and you should approach it with caution.

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
        PostgreSQL. It interfaces with an LMS by acting as an LTI
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

In my dev environment, I run CodeGrinder and PostgreSQL on the same
server and connect to PostgreSQL using Unix-domain sockets with
ident authentication. These instructions assume you are doing the
same. You may need to adjust if you have a different setup.

All instructions here assume a Debian Jessie server environment.


### Install Go environment (all nodes)

Start with a Go build environment with Go 1.8 or higher. Make sure
your GOPATH is set correctly.

Get the URL for the latest version of Go here:

* https://golang.org/dl/

Using that URL (this example assumes version 1.8beta2), install Go
using:

    curl -s https://storage.googleapis.com/golang/go1.8beta2.linux-amd64.tar.gz | sudo tar zxvf - -C /usr/local
    cd /usr/local/bin
    sudo ln -s ../go/bin/* ./

If you are upgrading Go, first delete the old version (delete
`/usr/local/go`) and skip the `sudo ln -s ../go/bin/* ./` part.

Be sure to set your `GOPATH` variable. I add this line to
`~/.profile`:

    export GOPATH=$HOME

Then log out and log back in so it will take effect.


### Install database (TA node only)

Install PostgreSQL version 9.4 or higher. Note that you only need
PostgreSQL on the TA node:

* http://wiki.postgresql.org/wiki/Apt

Run the database setup script. Warning: this will delete an existing
installation, so use this with caution.

    $GOPATH/src/github.com/russross/codegrinder/setup/setup-database.sh


### Install Docker (daycare nodes only)

Install and configure Docker, and add your CodeGrinder user to the
`docker` group so it can manage containers without being root. Note
that you only need this on daycare nodes:

* https://docs.docker.com/engine/installation/linux/debian/


### Install CodeGrinder

Fetch the CodeGrinder repository:

    mkdir -p $GOPATH/src/github.com/russross
    cd $GOPATH/src/github.com/russross
    git clone https://github.com/russross/codegrinder.git

Build and install CodeGrinder. For a TA node, use:

    $GOPATH/src/github.com/russross/codegrinder/all.sh

This creates two executables for the local machine, `codegrinder`
(the server) and `grind` (the command-line tool) and installs them
both in `/usr/local/bin`. It also builds the `grind` tool for
several architectures and puts them in the `www` directory for users
to download.

For a daycare node that is not also a TA node, use:

    $GOPATH/src/github.com/russross/codegrinder/build.sh

This only builds and installs the server. Both of these scripts
also give the `codegrinder` binary the capability to bind to
low-numbered ports, so CodeGrinder does not need any other special
privileges to run. It should NOT be run as root.


### Configure CodeGrinder

Next, configure CodeGrinder:

    sudo mkdir /etc/codegrinder
    sudo chown $USER.$USER /etc/codegrinder

Create a config file that is customized for your installation. It
should be saved as `/etc/codegrinder/config.json` and its contents
depend on what role this node will take. All nodes should contain
the following:

    {
        "hostname": "your.domain.name",
        "daycareSecret": "",
        "letsEncryptEmail": "yourname@domain.com"
    }

For the node running the TA role, you should add these keys:

        "ltiSecret": "",
        "sessionSecret": "",
        "wwwDir": "/home/username/src/github.com/russross/codegrinder/www",
        "filesDir": "/home/username/src/github.com/russross/codegrinder/files",

and for nodes running the daycare role, you should add these keys:

        "taHostname": "your.ta.domain.name",
        "capacity": 1,
        "problemTypes": [
            "python27unittest"
        ],

Put in your domain name and the contact email to use when
registering TLS certificates with LetsEncrypt. For the secrets,
generate each one using:

    head -c 32 /dev/urandom | base64

Run that command once and copy the output into the `ltiSecret`, then
run it again and copy the output to `sessionSecret`, then run it a
third time and copy the output to `daycareSecret`. The
`daycareSecret` value must be shared by all nodes.

The `wwwDir` field is where the client code resides. There is a
placeholder page that helps students set up the `grind` tool in the
`www` directory of the distribution, so I suggest pointing it there.
The CodeGrinder TA server will serve any static files in the given
directory.

Note that there are other settings available that allow you to
customize the installation, but they are not documented here. If you
need them, check out the `Config` type defined in
`codegrinder/server.go`. The fields of that struct are the fields of
the config file.

For daycare nodes, you must also build the Docker images that will
host the student code:

    make -C $GOPATH/src/github.com/russross/codegrinder/containers amd64

Or if you are running on a Raspberry Pi and need the ARM images:

    make -C $GOPATH/src/github.com/russross/codegrinder/containers arm

At this point, you should be able to run the server. To run it with
only the TA service, use:

    codegrinder -ta

If you want a daycare running on the same node, use:

    codegrinder -ta -daycare

Leave it running in a terminal so you can watch the log output.

For normal use, you will want systemd to manage it:

    sudo cp $GOPATH/src/github.com/russross/codegrinder/setup/codegrinder.service /lib/systemd/system/

Then edit the file you have copied to customize it. In particular,
set the options in the executable to run as -ta, -daycare, or both,
and in the dependencies section, comment out the postgresql
dependency if this is not a TA role, and the docker dependency if
this is not a daycare role.

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


License
=======

CodeGrinder programming exercise system
Copyright © 2016–2017  Russ Ross

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
