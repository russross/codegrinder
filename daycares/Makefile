all:	amd64

amd64: .proxy-c .proxy-go .proxy-python .proxy-riscv .proxy-rust .proxy-sqlite

.proxy-c: c/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-c c
	touch .proxy-c

.proxy-cpp: cpp/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-cpp cpp
	touch .proxy-cpp

.proxy-forth: forth/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-forth forth
	touch .proxy-forth

.proxy-go: go/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-go go
	touch .proxy-go

.proxy-nand2tetris: nand2tetris/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-nand2tetris nand2tetris
	touch .proxy-nand2tetris

.proxy-prolog: prolog/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-prolog prolog
	touch .proxy-prolog

.proxy-python: python/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-python python
	touch .proxy-python

.proxy-riscv: riscv/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-riscv riscv
	touch .proxy-riscv

.proxy-rust: rust/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-rust rust
	touch .proxy-rust

.proxy-sqlite: sqlite/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-sqlite sqlite
	touch .proxy-sqlite

.proxy-standardml: standardml/Dockerfile
	docker build -t us-central1-docker.pkg.dev/codegrinder/codegrinder-images/daycare-standardml standardml
	touch .proxy-standardml
