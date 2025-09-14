# run "make amd64" to build Intel-based containers
# run "make arm64" to build 64-bit ARM-based containers

all:	amd64

arm64: .proxy-c .proxy-cpp .proxy-go .proxy-python .proxy-riscv .proxy-rust .proxy-sqlite .proxy-prolog .proxy-typescript

amd64: .proxy-c .proxy-go .proxy-python .proxy-riscv .proxy-rust .proxy-sqlite

.proxy-c: c/Dockerfile
	docker build --pull -t codegrinder/c c
	touch .proxy-c

.proxy-cpp: cpp/Dockerfile
	docker build --pull -t codegrinder/cpp cpp
	touch .proxy-cpp

.proxy-forth: forth/Dockerfile
	docker build --pull -t codegrinder/forth forth
	touch .proxy-forth

.proxy-go: go/Dockerfile
	docker build --pull -t codegrinder/go go
	touch .proxy-go

.proxy-nand2tetris: nand2tetris/Dockerfile
	docker build --pull -t codegrinder/nand2tetris nand2tetris
	touch .proxy-nand2tetris

.proxy-prolog: prolog/Dockerfile
	docker build --pull -t codegrinder/prolog prolog
	touch .proxy-prolog

.proxy-python: python/Dockerfile
	docker build --pull -t codegrinder/python python
	touch .proxy-python

.proxy-riscv: riscv/Dockerfile
	docker build --pull -t codegrinder/riscv riscv
	touch .proxy-riscv

.proxy-rust: rust/Dockerfile
	docker build --pull -t codegrinder/rust rust
	touch .proxy-rust

.proxy-sqlite: sqlite/Dockerfile
	docker build --pull -t codegrinder/sqlite sqlite
	touch .proxy-sqlite

.proxy-standardml: standardml/Dockerfile
	docker build --pull -t codegrinder/standardml standardml
	touch .proxy-standardml

.proxy-typescript: typescript/Dockerfile
	docker build --pull -t codegrinder/typescript typescript
	touch .proxy-typescript
