FROM resin/rpi-raspbian:jessie
MAINTAINER russ@russross.com

RUN apt-get update && apt-get upgrade -y

RUN apt-get install -y --no-install-recommends \
	build-essential \
	gdb \
	libgtest-dev

# install gtest
RUN g++ -c -g -std=c++11 -Wpedantic -Wall -Wextra -Werror -I/usr/src/gtest -pthread /usr/src/gtest/src/gtest-all.cc -o /tmp/gtest-all.o
    g++ -c -g -std=c++11 -Wpedantic -Wall -Wextra -Werror -I/usr/src/gtest -pthread /usr/src/gtest/src/gtest_main.cc -o /tmp/gtest_main.o
    ar rv /tmp/gtest_main.a /tmp/gtest-all.o /tmp/gtest_main.o
    rm -f /tmp/gtest-all.o /tmp/gtest_main.o
    mv /tmp/gtest_main.a /usr/local/lib/libgtest.a
    chmod 644 /usr/local/lib/libgtest.a
    chown root:root /usr/local/lib/libgtest.a

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
