FROM debian:jessie
MAINTAINER russ@russross.com

RUN apt-get update && \
    apt-get upgrade -y

RUN apt-get install -y --no-install-recommends \
    python3.4 \
    python-pip \
    python3-six \
    make \
    diff

RUN pip install autopep8

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
