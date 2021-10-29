FROM arm64v8/debian:bullseye
MAINTAINER russ@russross.com

RUN apt update && apt upgrade -y

RUN apt install -y --no-install-recommends \
    make \
    python3
RUN apt install -y --no-install-recommends \
    build-essential \
    gdb
RUN apt install -y --no-install-recommends \
    check \
    valgrind \
    libgtest-dev \
    pkg-config

RUN mkdir /home/student && chmod 777 /home/student
ADD .gdbinit /home/student/
USER 2000
WORKDIR /home/student
