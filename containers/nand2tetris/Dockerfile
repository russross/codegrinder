FROM debian:stretch
MAINTAINER russ@russross.com

RUN apt update && \
    apt upgrade -y

RUN apt install -y --no-install-recommends \
    default-jre-headless \
    make \
    unzip

# install software suite
ADD http://cit.dixie.edu/cs/2810/nand2tetris.zip /tmp/
RUN unzip -d /usr/local /tmp/nand2tetris.zip && \
    chmod 755 /usr/local/nand2tetris/tools/*.sh && \
    rm -f /tmp/nand2tetris.zip

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
