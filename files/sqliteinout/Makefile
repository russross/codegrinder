.SUFFIXES:
.SUFFIXES: .db .sql .actual .expected .xml

all:	step

test:	$(HOME)/.sqliterc
	@rm -f database.db outputs/*.actual
	@for x in $(shell ls .*.sql); do sqlite3 database.db < $$x > /dev/null; done
	@python3 lib/inout-runner.py

grade:	$(HOME)/.sqliterc
	@rm -f database.db test_detail.xml outputs/*.actual
	@for x in $(shell ls .*.sql); do sqlite3 database.db < $$x > /dev/null; done
	@python3 lib/inout-runner.py

step:	$(HOME)/.sqliterc
	@rm -f database.db
	@for x in $(shell ls .*.sql); do sqlite3 database.db < $$x > /dev/null; done
	@python3 lib/inout-stepall.py

$(HOME)/.sqliterc:	lib/.sqliterc
	cp lib/.sqliterc $(HOME)/

setup:
	sudo apt install -y sqlite3 make python3

clean:
	rm -f test_detail.xml database.db outputs/*.actual
