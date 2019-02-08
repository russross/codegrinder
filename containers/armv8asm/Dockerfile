FROM arm64v8/debian:stretch
MAINTAINER russ@russross.com

RUN apt-get update && apt-get upgrade -y

RUN apt-get install -y --no-install-recommends \
    build-essential \
    gdb \
    pkg-config \
    check \
    valgrind

RUN mkdir /home/student && chmod 777 /home/student
ADD .gdbinit /home/student/
USER 2000
WORKDIR /home/student
