CodeGrinder is a tool that hosts programming exercises for students.
Problems are graded using unit tests, and scores are posted back to
an LMS such as Canvas using the LTI protocol.


Project status
==============

This is a tool we use internally at Utah Tech University in our
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

Rust build, cross-compilation, configuration, service, and database
safety instructions are in `SETUP.md`.


License
=======

CodeGrinder is licenced under the AGPL. I am willing to consider
re-licensing CodeGrinder under a more permissive license, depending
on the use case. Please contact me if you wish to discuss this.


CodeGrinder programming exercise system
Copyright © 2016–2024  Russ Ross

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
