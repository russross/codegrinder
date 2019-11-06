.SUFFIXES:
.SUFFIXES: .s .o .cpp .out .xml *.log

AOUTSOURCE=$(sort $(wildcard *.cpp))
AOUTOBJECT=$(AOUTSOURCE:.cpp=.o)
UNITSOURCE=$(filter-out main.cpp, $(AOUTSOURCE))
UNITOBJECT=$(UNITSOURCE:.cpp=.o)
TESTSOURCE=$(sort $(wildcard tests/*.cpp))
TESTOBJECT=$(TESTSOURCE:.cpp=.o)
CXXFLAGS=-std=c++11 -Wpedantic -g -Wall -Wextra -Werror -I. -pthread
AOUTLDFLAGS=-lpthread
UNITLDFLAGS=-lgtest -lpthread
CXX=g++

all:	test

test:	unittest.out
	./unittest.out

grade:	unittest.out
	./unittest.out --gtest_output=xml

valgrind:	unittest.out
	rm -f valgrind.log
	-valgrind --leak-check=full --track-fds=yes --log-file=valgrind.log ./unittest.out
	cat valgrind.log

debug-test: unittest.out
	gdb ./unittest.out

run:	a.out
	./a.out

debug:	a.out
	gdb ./a.out

.cpp.o:
	$(CXX) $(CXXFLAGS) -c $< -o $@

a.out:	$(AOUTOBJECT)
	$(CXX) $(CXXFLAGS) $^ $(AOUTLDFLAGS)

unittest.out:	$(UNITOBJECT) $(TESTOBJECT)
	$(CXX) $(CXXFLAGS) $^ $(UNITLDFLAGS) -o $@

setup:
	# install build tools, sources for gtest, and valgrind
	sudo apt install -y build-essential make gdb libgtest-dev valgrind
	# build the gtest unit test library
	g++ -c -g -std=c++11 -Wpedantic -Wall -Wextra -Werror -I/usr/src/gtest -pthread /usr/src/gtest/src/gtest-all.cc -o /tmp/gtest-all.o
	g++ -c -g -std=c++11 -Wpedantic -Wall -Wextra -Werror -I/usr/src/gtest -pthread /usr/src/gtest/src/gtest_main.cc -o /tmp/gtest_main.o
	ar rv /tmp/gtest_main.a /tmp/gtest-all.o /tmp/gtest_main.o
	rm -f /tmp/gtest-all.o /tmp/gtest_main.o
	sudo mv /tmp/gtest_main.a /usr/local/lib/libgtest.a
	sudo chmod 644 /usr/local/lib/libgtest.a
	sudo chown root:root /usr/local/lib/libgtest.a

clean:
	rm -f $(UNITOBJECT) $(LIBOBJECT) $(TESTOBJECT) *.out *.xml
