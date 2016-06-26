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

    a)  The TA service: this manages bookkeeping and runs on top of
        PostgreSQL. It interfaces with an LMS by acting as an LTI
        tool provider. An LMS such as Canvas hosts an assignment
        page, and directs students to the TA service complete with
        basic credentials, login information, and information about
        the problem set that was assigned. The TA then acts as an
        API server for basic bookkeeping tasks.

    b)  The daycare service: this runs student code with
        problem-specific unit tests in Docker containers, streams
        the results back to the client in real time, and returns a
        report card with the results.

2.  The grind command-line tool. This provides a command-line user
    intereface for students, instructors, and problem authors.
    Students can see their currently-assigned problems, pull them
    onto their local machines, and submit them for grading.


Installation
============

Instructions are not ready yet. Contact me directly for help with
installation. At this early stage, I will probably only respond if I
know you personally, but as I get closer to completing the core
functionality, I will update these instructions and start paying
attention to feedback.
