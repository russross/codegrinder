all:
	# run "make amd64" to build all Intel-based containers
	# run "make arm" to build all ARM-based containers

arm: .proxy-armv6asm

amd64: .proxy-go .proxy-prolog .proxy-python .proxy-standardml .proxy-cpp

.proxy-armv6asm: armv6asm/Dockerfile
	docker build -t codegrinder/armv6asm armv6asm
	touch .proxy-armv6asm

.proxy-go: go/Dockerfile
	docker build -t codegrinder/go go
	touch .proxy-go

.proxy-prolog: prolog/Dockerfile
	docker build -t codegrinder/prolog prolog
	touch .proxy-prolog

.proxy-python: python/Dockerfile
	docker build -t codegrinder/python python
	touch .proxy-python

.proxy-standardml: standardml/Dockerfile
	docker build -t codegrinder/standardml standardml
	touch .proxy-standardml

.proxy-cpp: cpp/Dockerfile
	docker build -t codegrinder/cpp cpp
	touch .proxy-cpp
