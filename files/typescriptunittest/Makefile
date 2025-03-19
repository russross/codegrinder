test:
	npx jest --config=tests/jest.config.ts --no-cache

grade:
	rm -f test_detail.xml
	JEST_JUNIT_OUTPUT_DIR="./" JEST_JUNIT_OUTPUT_NAME="test_detail.xml" npx jest --config=tests/jest.config.ts --no-cache --reporters=default --reporters=jest-junit
