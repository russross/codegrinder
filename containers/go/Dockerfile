FROM arm64v8/debian:bookworm
MAINTAINER russ@russross.com

RUN apt update

RUN apt install -y --no-install-recommends \
    make \
    python3
RUN apt install -y --no-install-recommends \
    golang

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
