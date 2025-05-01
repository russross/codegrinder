.PHONY: setup clean test typecheck grade

ifeq ($(shell pwd),/home/student)
  JEST := ../node_modules/.bin/jest
  LINT := ../node_modules/.bin/eslint
else
  JEST := node_modules/.bin/jest
  LINT := node_modules/.bin/eslint
endif

all: test

setup:
	@if [ `pwd` != "/home/student" ]; then \
		npm install; \
	fi

linter: setup
	$(LINT) . --config tests/eslint.config.mjs --no-cache

typecheck: linter
	npm run typecheck

test: typecheck
	$(JEST) --config=tests/jest.config.ts

grade: linter 
	rm -f test_detail.xml
	JEST_JUNIT_OUTPUT_DIR="./" JEST_JUNIT_OUTPUT_NAME="test_detail.xml" $(JEST) --config=tests/jest.config.ts --no-cache --reporters=default --reporters=jest-junit

clean:
	rm -rf node_modules dist coverage test_detail.xml
