.PHONY: setup clean test typecheck grade

ifeq ($(shell pwd),/home/student)
  JEST := ../node_modules/.bin/jest
else
  JEST := node_modules/.bin/jest
endif

all: test

setup:
	@if [ `pwd` != "/home/student" ]; then \
		npm install; \
	fi

typecheck: setup
	npm run typecheck

test: typecheck
	$(JEST) --config=tests/jest.config.ts

grade: setup
	rm -f test_detail.xml
	JEST_JUNIT_OUTPUT_DIR="./" JEST_JUNIT_OUTPUT_NAME="test_detail.xml" $(JEST) --config=tests/jest.config.ts --no-cache --reporters=default --reporters=jest-junit

clean:
	rm -rf node_modules dist coverage test_detail.xml
