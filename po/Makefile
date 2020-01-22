
XGETTEXT = /usr/bin/xgettext
MSGINIT = /usr/bin/msginit
MSGFMT = /usr/bin/msgfmt
MSGMERGE = /usr/bin/msgmerge

PACKAGE := gnome-shell

# xgettext flags
XGETTEXT_OPT := -D .. -d ${PACKAGE}
XGETTEXT_OPT := ${XGETTEXT_OPT} -c --from-code=UTF-8 -k_ -kN_ -kC_:1c,2 -kNC_:1c,2
XGETTEXT_OPT := ${XGETTEXT_OPT} --package-name ${PACKAGE}

LINGUAS := $(shell cat LINGUAS|sed '/^[^a-z]/d')

POFILES := $(patsubst %,%.po,$(LINGUAS))


.PHONY: update-po check
ifneq (${V},1)
.SILENT:
endif

all: update-po

%.po: ${PACKAGE}.pot
	@if [ -a $@ ] ; then \
		echo -e "  \e[1;34mMSGMERGE\e[0m $*" ; \
		$(MSGMERGE) -q -U --backup=off $@ ${PACKAGE}.pot ; \
	else \
		echo -e "  \e[1;34mMSGINIT\e[0m $*" ; \
		$(MSGINIT) -o $@ -i ${PACKAGE}.pot --l $* --no-translator ; \
	fi

$(PACKAGE).pot: POTFILES.in
	@echo -e "  \e[1;34mXGETTEXT\e[0m $@"
	$(XGETTEXT) ${XGETTEXT_OPT} -o $@ -f $<

update-po: ${PACKAGE}.pot ${POFILES}

check:
	@for po in ${POFILES} ; do \
		$(MSGFMT) -c $$po ; \
	done
