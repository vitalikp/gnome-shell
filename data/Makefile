
GCR = /usr/bin/glib-compile-resources

PACKAGE := gnome-shell

RESOURCES := \
	dbus-interfaces \
	osk-layouts \
	theme


.PHONY: all ${RESOURCES} clean
ifneq (${V},1)
.SILENT:
endif

all: ${RESOURCES}

${RESOURCES}:
	@echo -e "\e[1;34m   GCR\e[0m\t"${PACKAGE}-$@.gresource.xml
	$(GCR) --sourcedir . --sourcedir $@ ${PACKAGE}-$@.gresource.xml

clean: 
	@for res in ${RESOURCES} ; do \
		if [ -e $(PACKAGE)-$$res.gresource ] ; then \
			echo -e "  \e[1;31mRM\e[0m\t"$(PACKAGE)-$$res.gresource ; \
			$(RM) $(PACKAGE)-$$res.gresource ; \
		fi ; \
	done
