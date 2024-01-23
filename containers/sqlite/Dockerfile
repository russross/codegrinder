FROM arm64v8/alpine:3.19
MAINTAINER russ@russross.com

RUN apk add --no-cache \
    make \
    python3
RUN apk add --no-cache \
    sqlite

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
