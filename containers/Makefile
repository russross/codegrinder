all:
	# run "make amd64" to build all Intel-based containers
	# run "make arm" to build all ARM-based containers

arm: .proxy-armv6asm

amd64: .proxy-python .proxy-standardml

.proxy-python: python/Dockerfile
	docker build -t codegrinder/python python
	touch .proxy-python

.proxy-armv6asm: armv6asm/Dockerfile
	docker build -t codegrinder/armv6asm armv6asm
	touch .proxy-armv6asm

.proxy-standardml: standardml/Dockerfile
	docker build -t codegrinder/standardml standardml
	touch .proxy-standardml
