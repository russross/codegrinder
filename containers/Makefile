all:

arm: .proxy-armv6asm

amd64: .proxy-python2

.proxy-python2: python2/Dockerfile
	docker build -t codegrinder/python2 python2
	touch .proxy-python2

.proxy-armv6asm: armv6asm/Dockerfile
	docker build -t codegrinder/armv6asm armv6asm
	touch .proxy-armv6asm
