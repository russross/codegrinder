FROM arm64v8/debian:buster
MAINTAINER russ@russross.com

RUN apt update && apt upgrade -y

RUN apt install -y --no-install-recommends \
    build-essential \
    gdb \
    pkg-config \
    check \
    valgrind \
    python3

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
