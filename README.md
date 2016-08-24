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


### Install database (TA node only)

Install PostgreSQL version 9.4 or higher. Note that you only need
PostgreSQL on the TA node.

Run the database setup script. Warning: this will delete an existing
installation, so use this with caution.

    $GOPATH/src/github.com/russross/codegrinder/setup/setup-database.sh


### Install Docker (daycare nodes only)

Install and configure Docker, and add your CodeGrinder user to the
docker group so it can manage containers without being root. Note
that you only need this on daycare nodes.


### Install CodeGrinder

Start with a Go build environment with Go 1.6 or higher. Make sure
your GOPATH is set correctly.

Fetch the CodeGrinder repository:

    mkdir -p $GOPATH/src/github.com/russross
    cd $GOPATH/src/github.com/russross
    git clone https://github.com/russross/codegrinder.git

Build and install CodeGrinder:

    $GOPATH/src/github.com/russross/codegrinder/all.sh

This creates two executables for the local machine, `codegrinder`
(the server) and `grind` (the command-line tool) and installs them
both in `/usr/local/bin`. It also builds the `grind` tool for
several architectures and puts them in the `www` directory for users
to download. Use the `build.sh` script instead to only build the
server. Both of these scripts also give the `codegrinder` binary the
capability to bind to low-numbered ports, so CodeGrinder does not
need any other special privileges to run. It should NOT be run as
root.


### Configure CodeGrinder

Next, configure CodeGrinder:

    sudo mkdir /etc/codegrinder
    sudo chown username.username /etc/codegrinder

Create a config file that is customized for your installation. It
should be saved as `/etc/codegrinder/config.json` and its contents
depend on what role this node will take. All nodes should contain
the following:

    {
        "hostname": "your.domain.name",
        "daycareSecret": "",
        "letsEncryptEmail": "yourname@domain.com",
        "filesDir": "/home/username/src/github.com/russross/codegrinder/files"
    }

For the node running the TA role, you should add these keys:

        "ltiSecret": "",
        "sessionSecret": "",
        "staticDir": "/home/username/src/github.com/russross/codegrinder/www",

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

The `staticDir` field is where the client code resides. It does not
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

To start it, use:

    sudo systemctl start codegrinder

To stop it:

    sudo systemctl stop codegrinder

To check if it is running and see the most recent log messages:

    sudo systemctl status codegrinder

To review the logs:

    sudo journalctl -xeu codegrinder


### Additional help

Contact me directly for help with installation. At this early stage,
I will probably only respond if I know you personally, but as I get
closer to completing the core functionality, I will update these
instructions and start paying attention to feedback.
