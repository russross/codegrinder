FROM alpine:latest

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
RUN apk add --no-cache \
    icdiff \
    make \
    python3
RUN apk add --no-cache \
    build-base \
    valgrind
RUN apk add --no-cache \
    py3-mypy \
    py3-pip \
    py3-pygame \
    py3-setuptools \
    py3-six \
    diffutils
RUN pip3 install --break-system-packages unittest-xml-reporting cisc108
