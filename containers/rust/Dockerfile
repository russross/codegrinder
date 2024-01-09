FROM arm64v8/debian:bookworm
MAINTAINER russ@russross.com

RUN apt update

RUN apt install -y --no-install-recommends \
    make \
    python3
RUN apt install -y --no-install-recommends \
    build-essential \
    gdb
RUN apt install -y --no-install-recommends \
    cargo

ADD https://computing.utahtech.edu/cs/3520/cargo2junit /usr/local/bin/
RUN chmod 755 /usr/local/bin/cargo2junit

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
