FROM alpine:latest

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
RUN apk add --no-cache \
    make \
    python3
RUN apk add --no-cache \
    openjdk8-jre \
    unzip

# install software suite
ADD https://www.cs.utahtech.edu/cs/2810/nand2tetris.zip /tmp/
RUN unzip -d /usr/local /tmp/nand2tetris.zip && \
    chmod 755 /usr/local/nand2tetris/tools/*.sh && \
    rm -f /tmp/nand2tetris.zip
