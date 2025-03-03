FROM arm64v8/alpine:edge

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
RUN apk add --no-cache \
    icdiff \
    make \
    python3
RUN apk add --no-cache \
    clang \
    lld
RUN apk add --no-cache \
    valgrind
