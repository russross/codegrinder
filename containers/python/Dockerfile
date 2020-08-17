FROM arm64v8/debian:buster
MAINTAINER russ@russross.com

RUN apt update && apt upgrade -y

RUN apt install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-six \
    python3-setuptools \
    make \
    diffutils

RUN pip3 install unittest-xml-reporting

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
