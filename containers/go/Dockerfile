FROM alpine:latest

RUN mkdir /home/student && chmod 777 /home/student
ENV HOME=/home/student
WORKDIR /home/student
RUN apk add --no-cache \
    make \
    python3
ENV GODEBUG=installgoroot=all
RUN apk add --no-cache \
    go
RUN mkdir /go-cache && chmod 777 /go-cache
ENV GOCACHE=/go-cache
ENV CGO_ENABLED=0
RUN umask 0000 && go install -a std
