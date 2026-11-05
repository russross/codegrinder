.PHONY: all web vm grind-dist mostlyclean clean
all: web vm

# Each application owns its deployment assets and locked dependency installation.
web:
	$(MAKE) -C web
vm:
	$(MAKE) -C ../client
grind-dist:
	$(MAKE) -C ../grind grind-dist

mostlyclean:
	$(MAKE) -C web mostlyclean
	$(MAKE) -C ../client mostlyclean
	$(MAKE) -C ../grind mostlyclean-dist

clean:
	$(MAKE) -C web clean
	$(MAKE) -C ../client clean
	$(MAKE) -C ../grind clean-dist
