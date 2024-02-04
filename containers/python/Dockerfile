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
    mypy \
    python3-pip \
    python3-setuptools \
    python3-six \
    diffutils
RUN apt install -y --no-install-recommends \
    libsdl2-dev \
    libsdl2-image-dev \
    libsdl2-mixer-dev \
    libsdl2-ttf-dev \
    libfreetype6-dev \
    libjpeg-dev \
    python3-dev \
    libportmidi-dev    

RUN pip3 install --break-system-packages unittest-xml-reporting cisc108 pygame

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
