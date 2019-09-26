FROM debian:buster
MAINTAINER russ@russross.com

RUN apt update && apt upgrade -y

RUN apt install -y --no-install-recommends \
    swi-prolog \
    python3 \
    make

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
