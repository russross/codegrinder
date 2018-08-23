FROM debian:jessie
MAINTAINER russ@russross.com

RUN apt-get update && \
    apt-get upgrade -y

RUN apt-get install -y --no-install-recommends \
    default-jdk \
    curl \
    unzip

# install software suite
RUN curl -q http://cit.dixie.edu/cs/2810/nand2tetris.zip -o /tmp/nand2tetris.zip && \
    sudo unzip -d /usr/local /tmp/nand2tetris.zip && \
    sudo chmod 755 /usr/local/nand2tetris/tools/*.sh && \
    rm -f /tmp/nand2tetris.zip

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
