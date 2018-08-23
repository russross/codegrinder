FROM debian:jessie
MAINTAINER russ@russross.com

RUN apt-get update && \
    apt-get upgrade -y

RUN apt-get install -u --no-install-recommends \
    make

ADD https://dl.google.com/go/go1.10.3.linux-amd64.tar.gz /tmp/
RUN tar zxf /tmp/go1.10.3.linux-amd64.tar.gz -C /usr/local && \
    ln -s ../go/bin/go /usr/local/bin/go && \
    ln -s ../go/bin/godoc /usr/local/bin/godoc && \
    ln -s ../go/bin/gofmt /usr/local/bin/gofmt && \
    rm -f /tmp/go1.10.3.linux-amd64.tar.gz

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
