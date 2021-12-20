FROM arm64v8/debian:bullseye
MAINTAINER russ@russross.com

RUN apt update && apt upgrade -y

RUN apt install -y --no-install-recommends \
    make \
    python3
RUN apt install -y --no-install-recommends \
    qemu-user

# install cross-compiler
ADD https://cit.dixie.edu/cs/2810/riscv.tar.gz /tmp/
RUN tar zxvf /tmp/riscv.tar.gz -C /opt && \
    rm -f /tmp/riscv.tar.gz
RUN sed -i 's!PATH="\(.*\)"!PATH="\1:/opt/riscv/bin"!' /etc/profile

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
