.SUFFIXES:
.SUFFIXES: .db .sql .transcript .xml

STEPPER_DIR=outputs
STEPPER_TIMEOUT=5
STEPPER_POSTERRORLINES=15
STEPPER_CMD=sqlite3 --batch database.db ".read @INPUT@"
STEPPER_INPUT_TRANSFORM=s/outputs\/(.*).transcript/\1.sql/
STEPPER_GRADE=false
SETUP_SQL_FILES=$(sort $(wildcard .*.sql .*.sql.gz))
export STEPPER_DIR STEPPER_TIMEOUT STEPPER_POSTERRORLINES STEPPER_CMD STEPPER_INPUT_TRANSFORM STEPPER_GRADE

.PHONY: all grade step shell setup-db clean

all:	step

grade:	export STEPPER_GRADE := true
grade:	setup-db
	@rm -f test_detail.xml
	python3 lib/stepper

step:	setup-db
	@python3 lib/stepper

shell:	setup-db
	sqlite3 database.db

setup-db:	$(HOME)/.sqliterc
	@rm -f database.db
	@for x in $(SETUP_SQL_FILES); do \
		case "$$x" in \
			*.sql.gz) zcat "$$x" | sqlite3 database.db > /dev/null ;; \
			*.sql) sqlite3 database.db < "$$x" > /dev/null ;; \
		esac; \
	done

$(HOME)/.sqliterc:	lib/.sqliterc
	cp lib/.sqliterc $(HOME)/

clean:
	rm -f test_detail.xml database.db
