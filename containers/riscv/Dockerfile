FROM alpine:latest

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
RUN apk add --no-cache \
    make \
    python3
RUN apk add --no-cache \
    clang \
    clang-extra-tools \
    lld
ADD https://github.com/russross/risclet/releases/download/v0.3.10/risclet-x86_64-unknown-linux-musl \
    /usr/local/bin/risclet
RUN chmod 0755 /usr/local/bin/risclet
