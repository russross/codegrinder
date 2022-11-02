FROM arm64v8/debian:bullseye
MAINTAINER russ@russross.com

RUN apt update && apt upgrade -y

RUN apt install -y --no-install-recommends \
    make \
    python3
RUN apt install -y --no-install-recommends \
    build-essential \
    gdb

ADD https://static.rust-lang.org/dist/rust-1.64.0-aarch64-unknown-linux-gnu.tar.gz /tmp/
RUN cd /tmp/ && \
    tar zxf rust-1.64.0-aarch64-unknown-linux-gnu.tar.gz && \
    cd rust-1.64.0-aarch64-unknown-linux-gnu/ && \
    ./install.sh && \
    cd .. && \
    rm -rf rust-1.64.0-aarch64-unknown-linux-gnu/ rust-1.64.0-aarch64-unknown-linux-gnu.tar.gz

ADD https://computing.utahtech.edu/cs/3520/cargo2junit /usr/local/bin/
RUN chmod 755 /usr/local/bin/cargo2junit

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
