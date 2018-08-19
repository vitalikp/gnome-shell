
export PACKAGE := gnome-shell
export VERSION := $(shell cat version)


ifneq (${V},1)
.SILENT:
endif

all:

dist:
	@echo $(PACKAGE)-$(VERSION).tar.xz
	git archive --prefix $(PACKAGE)-$(VERSION)/ HEAD | xz -c > $(PACKAGE)-$(VERSION).tar.xz
