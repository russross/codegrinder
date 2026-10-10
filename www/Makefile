.PHONY: all web exam grind-dist mostlyclean clean
all: web exam

# Each application owns its deployment assets and locked dependency installation.
web:
	$(MAKE) -C web
exam:
	$(MAKE) -C exam
grind-dist:
	$(MAKE) -C ../grind grind-dist

mostlyclean:
	$(MAKE) -C web mostlyclean
	$(MAKE) -C exam mostlyclean
	$(MAKE) -C ../grind mostlyclean-dist

clean:
	$(MAKE) -C web clean
	$(MAKE) -C exam clean
	$(MAKE) -C ../grind clean-dist
