FROM arm64v8/alpine:edge
MAINTAINER russ@russross.com

RUN apk add --no-cache \
    make \
    python3
RUN apk add --no-cache -X http://dl-cdn.alpinelinux.org/alpine/edge/testing \
    swi-prolog

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
