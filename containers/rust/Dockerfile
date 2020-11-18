FROM arm64v8/debian:buster
MAINTAINER russ@russross.com

RUN ls
RUN apt update && apt upgrade -y

RUN apt install -y --no-install-recommends \
    cargo \
    make

ADD https://cit.dixie.edu/cs/3520/cargo2junit /usr/local/bin/
RUN chmod 755 /usr/local/bin/cargo2junit

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
