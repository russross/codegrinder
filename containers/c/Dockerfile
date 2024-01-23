FROM arm64v8/alpine:3.19
MAINTAINER russ@russross.com

RUN apk add --no-cache \
    make \
    python3
RUN apk add --no-cache \
    gcc \
    musl-dev \
    check \
    valgrind \
    pkgconf

RUN mkdir /home/student && chmod 777 /home/student
ADD .gdbinit /home/student/
USER 2000
WORKDIR /home/student
