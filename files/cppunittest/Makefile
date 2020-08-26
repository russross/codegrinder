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
UNITLDFLAGS=-lgtest -lgtest_main -lpthread
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
	(main_count=$$(egrep '^int *main' $(UNITSOURCE) | wc -l); \
	 if [ $$main_count -gt 0 ]; then \
	   echo; echo "Your file with main() should not be here."; echo; \
	   egrep '^int *main' $(UNITSOURCE); \
	   echo; \
	   exit 1; \
	 fi)
	$(CXX) $(CXXFLAGS) $^ $(UNITLDFLAGS) -o $@

# install build tools, sources for gtest, and valgrind
setup:
	sudo apt install -y build-essential make gdb libgtest-dev valgrind

clean:
	rm -f $(UNITOBJECT) $(LIBOBJECT) $(TESTOBJECT) *.out *.xml
