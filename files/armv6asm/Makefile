.SUFFIXES:
.SUFFIXES: .s .o .cpp .out .xml

ASMSOURCE=$(wildcard *.s)
ASMOBJECT=$(ASMSOURCE:.s=.o)
TSTSOURCE=$(filter-out start.s, $(ASMSOURCE))
TSTOBJECT=$(TSTSOURCE:.s=.o)
LIBSOURCE=$(wildcard lib/*.s)
LIBOBJECT=$(LIBSOURCE:.s=.o)
CPPSOURCE=$(wildcard tests/*.cpp)
CPPOBJECT=$(CPPSOURCE:.cpp=.o)

all:	test

test:	unittest.out
	./unittest.out

grade:	unittest.out
	./unittest.out --gtest_output=xml

run:	a.out
	./a.out

debug:	a.out
	gdb ./a.out

.s.o:
	as -g -march=armv6zk -mcpu=arm1176jzf-s -mfloat-abi=hard -mfpu=vfp $< -o $@

.cpp.o:
	g++ -c -g -pthread -std=c++11 -Wpedantic -Wall -Wextra -Werror $< -o $@

a.out:	$(ASMOBJECT)
	ld --fatal-warnings $^

unittest.out:	$(TSTOBJECT) $(LIBOBJECT) $(CPPOBJECT)
	g++ -g -pthread -lgtest -lpthread $(LIBOBJECT) $(CPPOBJECT) $(TSTOBJECT) -lgtest -lpthread -o $@

setup:
	# install build tools and sources for gtest
	sudo apt-get install -y build-essential gdb libgtest-dev
	# build the gtest unit test library
	g++ -c -g -std=c++11 -Wpedantic -Wall -Wextra -Werror -I/usr/src/gtest -pthread /usr/src/gtest/src/gtest-all.cc -o /tmp/gtest-all.o
	g++ -c -g -std=c++11 -Wpedantic -Wall -Wextra -Werror -I/usr/src/gtest -pthread /usr/src/gtest/src/gtest_main.cc -o /tmp/gtest_main.o
	ar rv /tmp/gtest_main.a /tmp/gtest-all.o /tmp/gtest_main.o
	rm -f /tmp/gtest-all.o /tmp/gtest_main.o
	sudo mv /tmp/gtest_main.a /usr/local/lib/libgtest.a
	sudo chmod 644 /usr/local/lib/libgtest.a
	sudo chown root:root /usr/local/lib/libgtest.a

clean:
	rm -f $(TSTOBJECT) $(LIBOBJECT) $(CPPOBJECT) *.out *.xml
