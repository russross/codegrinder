all:
	# run "make amd64" to build all Intel-based containers
	# run "make arm32" to build all 32-bit ARM-based containers
	# run "make arm64" to build all 64-bit ARM-based containers

arm32: .proxy-arm32asm

arm64: .proxy-arm64asm .proxy-python .proxy-forth .proxy-standardml .proxy-prolog .proxy-nand2tetris

amd64: .proxy-cpp .proxy-go

.proxy-arm32asm: arm32asm/Dockerfile
	docker build -t codegrinder/arm32asm arm32asm
	touch .proxy-arm32asm

.proxy-arm64asm: arm64asm/Dockerfile
	docker build -t codegrinder/arm64asm arm64asm
	touch .proxy-arm64asm

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
