FROM arm64v8/alpine:edge
MAINTAINER russ@russross.com

RUN apk add --no-cache \
    make \
    python3
RUN apk add --no-cache \
    cargo

ADD https://computing.utahtech.edu/cs/3520/cargo2junit /usr/local/bin/
RUN chmod 755 /usr/local/bin/cargo2junit

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
