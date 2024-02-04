FROM arm64v8/alpine:edge
MAINTAINER russ@russross.com

RUN apk add --no-cache \
    icdiff \
    make \
    python3
RUN apk add --no-cache \
    build-base
RUN apk add --no-cache \
    check \
    pkgconf \
    valgrind

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
