.SUFFIXES:
.SUFFIXES: .db .sql .transcript .xml

STEPPER_DIR=outputs
STEPPER_TIMEOUT=5
STEPPER_POSTERRORLINES=15
STEPPER_CMD=sqlite3 --batch database.db ".read @INPUT@"
STEPPER_INPUT_TRANSFORM=s/outputs\/(.*).transcript/\1.sql/
STEPPER_GRADE=false
export STEPPER_DIR STEPPER_TIMEOUT STEPPER_POSTERRORLINES STEPPER_CMD STEPPER_INPUT_TRANSFORM STEPPER_GRADE

all:	step

grade:	export STEPPER_GRADE := true
grade:	$(HOME)/.sqliterc
	@rm -f database.db test_detail.xml
	@for x in $(shell ls .*.sql); do sqlite3 database.db < $$x > /dev/null; done
	python3 lib/stepper

step:	$(HOME)/.sqliterc
	@rm -f database.db
	@for x in $(shell ls .*.sql); do sqlite3 database.db < $$x > /dev/null; done
	@python3 lib/stepper

shell:	$(HOME)/.sqliterc
	@rm -f database.db
	@for x in $(shell ls .*.sql); do sqlite3 database.db < $$x > /dev/null; done
	sqlite3 database.db

$(HOME)/.sqliterc:	lib/.sqliterc
	cp lib/.sqliterc $(HOME)/

clean:
	rm -f test_detail.xml database.db
