FROM arm64v8/alpine:edge
MAINTAINER russ@russross.com

RUN apk add --no-cache \
    icdiff \
    make \
    python3
RUN apk add --no-cache \
    go
RUN GODEBUG=installgoroot=all go install -a std

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
