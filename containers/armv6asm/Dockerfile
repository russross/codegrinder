FROM resin/rpi-raspbian:jessie
MAINTAINER russ@russross.com

# install packages
RUN apt-get update
RUN apt-get upgrade -y
RUN apt-get install -y \
	build-essential \
	gdb \
	libgtest-dev
RUN rm -rf /var/lib/apt/lists/*

# install gtest
WORKDIR /usr/local/lib
RUN g++ -std=c++11 -pthread -g -Wall -Wextra -Werror -I/usr/src/gtest -c /usr/src/gtest/src/gtest-all.cc && \
    g++ -std=c++11 -pthread -g -Wall -Wextra -Werror -I/usr/src/gtest -c /usr/src/gtest/src/gtest_main.cc && \
    ar rv gtest_main.a gtest-all.o gtest_main.o && \
    rm -f gtest-all.o gtest_main.o && \
    mv gtest_main.a libgtest.a && \
    chmod 644 libgtest.a

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
ENV HOME /home/student
WORKDIR /home/student
