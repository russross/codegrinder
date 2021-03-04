FROM arm64v8/debian:buster
MAINTAINER russ@russross.com

RUN apt update && apt upgrade -y

RUN apt install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-setuptools \
    python3-six \
    make \
    diffutils

RUN apt install -y --no-install-recommends \
    build-essential \
    libsdl2-dev \
    libsdl2-image-dev \
    libsdl2-mixer-dev \
    libsdl2-ttf-dev \
    libfreetype6-dev \
    libjpeg-dev \
    python3-dev \
    libportmidi-dev    

RUN pip3 install unittest-xml-reporting cisc108 pygame

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
