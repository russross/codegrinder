.SUFFIXES:
.SUFFIXES: .db .sql .actual .expected .xml

all:	step

test:
	rm -f database.db
	python3 lib/inout-runner.py

grade:
	rm -r database.db test_detail.xml outputs/*.actual
	python3 lib/inout-runner.py

step:
	rm -f database.db
	python3 lib/inout-stepall.py

setup:
	sudo apt install -y sqlite3 make python3

clean:
	rm -f test_detail.xml database.db outputs/*.actual
