FROM arm64v8/alpine:edge
MAINTAINER russ@russross.com

RUN apk add --no-cache \
    icdiff \
    make \
    python3
RUN apk add --no-cache \
    binutils-riscv64 \
    qemu-riscv64

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
