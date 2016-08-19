CodeGrinder is a tool that hosts programming exercises for students.
Problems are graded using unit tests, and scores are posted back to
an LMS such as Canvas using the LTI protocol.


Project status
==============

This is a rewrite of a tool we use internally at Dixie State
University in our Computer Science program. The version 1 system was
overly complex and was missing some crucial features. This is
currently a work in progress, and you should approach it with
caution.


What is here
============

This repository currently hosts two tools:

1.  The CodeGrinder server. This is further divided into two parts,
    which can run as part of the same service, or can be hosted on
    separate servers.

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

Start with a Go build environment with Go 1.5 or higher. Make sure
your GOPATH is set correctly.

Fetch the CodeGrinder repository:

    mkdir -p $GOPATH/src/github.com/russross
    cd $GOPATH/src/github.com/russross
    git clone https://github.com/russross/codegrinder.git

Build and install CodeGrinder:

    $GOPATH/src/github.com/russross/codegrinder/build.sh

This creates two executables, `codegrinder` (the server) and `grind`
(the command-line tool) and installs them both in `/usr/local/bin`.
It also gives `codegrinder` the capability to bind to low-numbered
ports, so CodeGrinder does not need any other special privileges to
run. It should NOT be run as root.

Install PostgreSQL version 9.4 or higher. Run psql as the postgres
user (the default admin user for PostgreSQL) and create the user and
database for CodeGrinder. Substitute your username wherever you see
`username` below.

    sudo -u postgres psql

From the `postgres=#` prompt:

    create user username;
    create database username;
    grant all privileges on database username to username;

At this point you should be able to run `psql` as your dev user and
it should connect to your new database without error. Next, set up
the database schema:

    psql < $GOPATH/src/github.com/russross/codegrinder/setup/schema.sql

Next, configure CodeGrinder:

    sudo mkdir /etc/codegrinder
    sudo chown username.username /etc/codegrinder

Create a config file that is customized for your installation. It
should be saved as `/etc/codegrinder/config.json` and its contents
depend on what role this node will take. All nodes should contain
the following:

    {
        "Hostname": "your.domain.name",
        "DaycareSecret": "",
        "LetsEncryptEmail": "yourname@domain.com"
    }

For the node running the TA role, you should add these keys:

        "LTISecret": "",
        "SessionSecret": "",
        "StaticDir": "/home/username/src/github.com/russross/codegrinder/client",

and for nodes running the daycare role, you should add these keys:

        "MainHostname": "your.ta.domain.name",
        "Capacity": 1,
        "ProblemTypes": [
            "python27unittest"
        ],

Put in your domain name and the contact email to use when
registering TLS certificates with LetsEncrypt. For the secrets,
generate each one using:

    head -c 32 /dev/urandom | base64

Run that command once and copy the output into the `LTISecret`, then
run it again and copy the output to `SessionSecret`, then run it a
third time and copy the output to `DaycareSecret`. The
`DaycareSecret` value must be shared by all nodes.

The `StaticDir` field is where the client code resides. It does not
exist right now, so this setting is not too important yet. The
CodeGrinder TA server will serve any static files in the given
directory.

Note that there are other settings available that allow you to
customize the installation, but they are not documented here. If you
need them, check out the `Config` type defined in
`codegrinder/server.go`. The fields of that struct are the fields of
the config file.

At this point, you should be able to run the server:

    codegrinder -ta

Leave it running in a terminal so you can watch the log output.

For normal use, you will want systemd to manage it:

    sudo cp $GOPATH/src/github.com/russross/codegrinder/setup/codegrinder.service /lib/systemd/system

Then edit the file you have copied to customize it. In particular,
set the options in the executable to run as -ta, -daycare, or both,
and in the dependencies section, comment out the postgresql
dependency if this is not a TA role, and the docker dependency if
this is not a daycare role.

Contact me directly for help with installation. At this early stage,
I will probably only respond if I know you personally, but as I get
closer to completing the core functionality, I will update these
instructions and start paying attention to feedback.
