.SUFFIXES:
.SUFFIXES: .db .sql .actual .expected .xml

STEPPER_DELAY=0.05
STEPPER_WARMUPDELAY=0.5
STEPPER_POSTCRASHLINES=15
STEPPER_WRONGLINES=10
STEPPER_SUFFIX=sql
STEPPER_INDIR=.
STEPPER_OUTDIR=outputs
STEPPER_CMD=sqlite3 database.db
export STEPPER_DELAY STEPPER_WARMUPDELAY STEPPER_POSTCRASHLINES STEPPER_WRONGLINES
export STEPPER_SUFFIX STEPPER_INDIR STEPPER_OUTDIR STEPPER_CMD

all:	step

grade:	$(HOME)/.sqliterc
	@rm -f database.db test_detail.xml outputs/*.actual
	@for x in $(shell ls .*.sql); do sqlite3 database.db < $$x > /dev/null; done
	@python3 lib/grader

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

setup:
	sudo apt install -y icdiff make python3 sqlite3

clean:
	rm -f test_detail.xml database.db outputs/*.actual
