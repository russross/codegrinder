FROM debian:buster
MAINTAINER russ@russross.com

RUN apt update && \
    apt upgrade -y

RUN apt install -y --no-install-recommends \
    polyml \
    rlwrap \
    make \
    python3

RUN cp -P /usr/lib/x86_64-linux-gnu/libpolyml.so.9 /usr/lib/x86_64-linux-gnu/libpolyml.so

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
