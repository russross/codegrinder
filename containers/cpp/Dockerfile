FROM alpine:latest

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
RUN apk add --no-cache \
    make \
    python3
RUN apk add --no-cache \
    build-base \
    valgrind
RUN apk add --no-cache \
    check \
    pkgconf
