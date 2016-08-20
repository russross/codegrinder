FROM resin/rpi-raspbian:jessie
MAINTAINER russ@russross.com

RUN apt-get update && \
	apt-get upgrade -y

RUN apt-get install -y --no-install-recommends \
	build-essential \
	gdb \
	libgtest-dev

# install gtest
WORKDIR /usr/local/lib
RUN g++ -std=c++11 -pthread -g -Wall -Wextra -Werror -I/usr/src/gtest -c /usr/src/gtest/src/gtest-all.cc && \
    g++ -std=c++11 -pthread -g -Wall -Wextra -Werror -I/usr/src/gtest -c /usr/src/gtest/src/gtest_main.cc && \
    ar rv libgtest.a gtest-all.o gtest_main.o && \
    rm -f gtest-all.o gtest_main.o && \
    chmod 644 libgtest.a

# install regwrapper
COPY regwrapper.s /usr/src/regwrapper/
RUN as -g -march=armv6zk -mcpu=arm1176jzf-s -mfloat-abi=hard -mfpu=vfp /usr/src/regwrapper/regwrapper.s -o regwrapper.o && \
    ar rvs libregwrapper.a regwrapper.o && \
    rm -f regwrapper.o && \
    chmod 644 libregwrapper.a

RUN mkdir /home/student && chmod 777 /home/student
USER 2000
WORKDIR /home/student
