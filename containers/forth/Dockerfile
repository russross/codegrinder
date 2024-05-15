FROM arm64v8/alpine:edge
MAINTAINER russ@russross.com

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
RUN apk add --no-cache \
    icdiff \
    make \
    python3
RUN apk add --no-cache -X http://dl-cdn.alpinelinux.org/alpine/edge/testing \
    gforth
