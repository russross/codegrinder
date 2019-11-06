.SUFFIXES:
.SUFFIXES: .tst .hdl .asm .hack .cmp .out .xml

all:	test

test:
	python3 bin/testrunner.py
	rm -f test_detail.xml

grade:
	rm -f test_detail.xml
	python3 bin/testrunner.py

setup:
	sudo apt install -y default-jre make curl unzip python3
	curl -s http://cit.dixie.edu/cs/2810/nand2tetris.zip -o /tmp/nand2tetris.zip
	sudo rm -rf /usr/local/nand2tetris
	sudo unzip -d /usr/local /tmp/nand2tetris.zip
	sudo chmod 755 /usr/local/nand2tetris/tools/*.sh
	rm -f /tmp/nand2tetris.zip

clean:
	rm -f test_detail.xml *.tst *.hack *.cmp *.out
