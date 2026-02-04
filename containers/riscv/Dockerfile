FROM alpine:latest

RUN mkdir /home/student && chmod 777 /home/student
ENV HOME=/home/student
WORKDIR /home/student
RUN apk add --no-cache \
    make \
    python3
ADD https://github.com/russross/risclet/releases/download/v0.4.3/risclet-x86_64-unknown-linux-musl \
    /usr/local/bin/risclet
RUN chmod 0755 /usr/local/bin/risclet
