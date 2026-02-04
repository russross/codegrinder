.SUFFIXES:
.SUFFIXES: .o .s .out .xml .input .transcript

ALLSRC=$(wildcard *.s)
START=$(filter start.s, $(ALLSRC))
AOUTSRC=$(START) $(filter-out $(START), $(ALLSRC))

RISCLET_VERSION=v0.4.3
STEPPER_CMD=risclet run --check-abi $(AOUTSRC)
STEPPER_DIR=inputs
STEPPER_TIMEOUT=5
STEPPER_POSTERRORLINES=15
STEPPER_GRADE=false
export STEPPER_CMD STEPPER_DIR STEPPER_TIMEOUT STEPPER_POSTERRORLINES STEPPER_GRADE

all:	step

grade:	export STEPPER_GRADE := true
grade:	risclet
	@rm -f test_details.xml
	python3 lib/stepper

run:	risclet
	risclet run $(AOUTSRC)

step:	risclet
	python3 lib/stepper

trace:	risclet
	risclet trace $(AOUTSRC)

debug:	risclet
	risclet debug $(AOUTSRC)

clean:
	rm -f core *.o *.out *.xml

.PHONY: risclet
risclet:
	@set -e; \
	if ! command -v risclet >/dev/null 2>&1; then \
		echo "risclet not found, installing..."; \
		$(MAKE) _install_risclet; \
	else \
		INSTALLED_VERSION="v$$(risclet --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"; \
		if [ "$$INSTALLED_VERSION" != "$(RISCLET_VERSION)" ]; then \
			echo "upgrading risclet to version $(RISCLET_VERSION)..."; \
			$(MAKE) _install_risclet; \
		fi; \
	fi

.PHONY: _install_risclet
_install_risclet:
	@set -e; \
	OS_NAME=$$(uname -s); \
	ARCH_NAME=$$(uname -m); \
	case "$$ARCH_NAME" in \
		arm64|aarch64) ARCH_NAME="aarch64" ;; \
		x86_64|amd64) ARCH_NAME="x86_64" ;; \
		*) echo "ERROR: Unsupported architecture: $$ARCH_NAME" >&2; exit 1 ;; \
	esac; \
	case "$$OS_NAME-$$ARCH_NAME" in \
		"Darwin-x86_64") RISCLET_BINARY="risclet-x86_64-apple-darwin" ;; \
		"Darwin-aarch64") RISCLET_BINARY="risclet-aarch64-apple-darwin" ;; \
		"Linux-x86_64") RISCLET_BINARY="risclet-x86_64-unknown-linux-musl" ;; \
		"Linux-aarch64") RISCLET_BINARY="risclet-aarch64-unknown-linux-musl" ;; \
		*) echo "ERROR: Unsupported platform: $$OS_NAME on $$ARCH_NAME" >&2; exit 1 ;; \
	esac; \
	RISCLET_URL="https://github.com/russross/risclet/releases/download/$(RISCLET_VERSION)/$$RISCLET_BINARY"; \
	echo "your password may be required"; \
	echo "downloading risclet for $$OS_NAME on $$ARCH_NAME..."; \
	TMPFILE=$$(mktemp); \
	if ! curl -fsSL "$$RISCLET_URL" -o "$$TMPFILE"; then \
		rm -f "$$TMPFILE"; \
		echo "ERROR: Failed to download risclet from $$RISCLET_URL" >&2; \
		exit 1; \
	fi; \
	if [ ! -d "/usr/local/bin" ]; then \
		echo "Creating /usr/local/bin..."; \
		sudo mkdir -p "/usr/local/bin"; \
	fi; \
	echo "installing risclet to /usr/local/bin..."; \
	sudo mv "$$TMPFILE" "/usr/local/bin/risclet"; \
	sudo chmod 755 "/usr/local/bin/risclet"; \
	case ":$$PATH:" in \
		*:/usr/local/bin:*) ;; \
		*) echo "Adding /usr/local/bin to PATH"; export PATH="/usr/local/bin:$$PATH" ;; \
	esac; \
	echo "risclet $$(risclet --version) installed successfully"
