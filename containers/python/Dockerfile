FROM arm64v8/alpine:edge
MAINTAINER russ@russross.com

RUN apk add --no-cache \
    icdiff \
    make \
    python3
RUN apk add --no-cache \
    build-base
RUN apk add --no-cache \
    py3-mypy \
    py3-pip \
    py3-setuptools \
    py3-six \
    diffutils
 RUN apk add --no-cache \
    sdl2-dev \
    sdl2_image-dev \
    sdl2_mixer-dev \
    sdl2_ttf-dev \
    freetype-dev \
    jpeg-dev \
    python3-dev \
    portmidi-dev

RUN pip3 install --break-system-packages unittest-xml-reporting cisc108 pygame

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student

