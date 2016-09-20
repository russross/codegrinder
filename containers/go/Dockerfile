FROM debian:jessie
MAINTAINER russ@russross.com

RUN apt-get update && \
    apt-get upgrade -y

ADD https://storage.googleapis.com/golang/go1.7.1.linux-amd64.tar.gz /tmp/
RUN tar zxf /tmp/go1.7.1.linux-amd64.tar.gz -C /usr/local && \
    ln -s ../go/bin/go /usr/local/bin/go && \
    ln -s ../go/bin/godoc /usr/local/bin/godoc && \
    ln -s ../go/bin/gofmt /usr/local/bin/gofmt

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
