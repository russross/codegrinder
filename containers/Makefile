all:
	# run "make amd64" to build all Intel-based containers
	# run "make arm" to build all 32-bit ARM-based containers
	# run "make arm64" to build all 64-bit ARM-based containers

arm: .proxy-armv6asm

arm64: .proxy-armv8asm

amd64: .proxy-cpp .proxy-go .proxy-nand2tetris .proxy-prolog .proxy-python .proxy-standardml .proxy-forth

.proxy-armv6asm: armv6asm/Dockerfile
	docker build -t codegrinder/armv6asm armv6asm
	touch .proxy-armv6asm

.proxy-armv8asm: armv8asm/Dockerfile
	docker build -t codegrinder/armv8asm armv8asm
	touch .proxy-armv8asm

.proxy-cpp: cpp/Dockerfile
	docker build -t codegrinder/cpp cpp
	touch .proxy-cpp

.proxy-go: go/Dockerfile
	docker build -t codegrinder/go go
	touch .proxy-go

.proxy-nand2tetris: nand2tetris/Dockerfile
	docker build -t codegrinder/nand2tetris nand2tetris
	touch .proxy-nand2tetris

.proxy-prolog: prolog/Dockerfile
	docker build -t codegrinder/prolog prolog
	touch .proxy-prolog

.proxy-python: python/Dockerfile
	docker build -t codegrinder/python python
	touch .proxy-python

.proxy-standardml: standardml/Dockerfile
	docker build -t codegrinder/standardml standardml
	touch .proxy-standardml

.proxy-forth: forth/Dockerfile
	docker build -t codegrinder/forth forth
	touch .proxy-forth
