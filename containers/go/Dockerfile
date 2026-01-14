FROM alpine:latest

RUN mkdir /home/student && chmod 777 /home/student
ENV HOME=/home/student
WORKDIR /home/student
RUN apk add --no-cache \
    make \
    python3
ENV GODEBUG=installgoroot=all
ENV GOCACHE=/tmp/go-cache
RUN apk add --no-cache \
    go
RUN go install -a std
