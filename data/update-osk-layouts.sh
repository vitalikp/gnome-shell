#!/bin/env bash

ARCHIVE="keyboards.zip"
CLDR_LAYOUTS_TARBALL="http://www.unicode.org/Public/cldr/latest/${ARCHIVE}"
CLDR2JSON_GIT="git://repo.or.cz/cldr2json.git"

CLDR2JSON="cldr2json/cldr2json.py"
GRESOURCE_FILE="osk-layouts.gresource.xml"
TMP_GRESOURCE_FILE=".$GRESOURCE_FILE.tmp"

destdir="$(realpath $0|xargs dirname)"
layouts="$(find osk-layouts -maxdepth 1 -type f -name "*.json" -exec basename {} .json \;|tr '\n' ' ')"
EXCLUDE="zu"


# create temporary work dir
workdir="$(mktemp -d /tmp/.osk-layouts.XXXXXX)"
echo "workdir: $workdir"
pushd "$workdir"

# Download stuff on the work dir
echo -n "loading ${ARCHIVE}..."
curl -s -LO $CLDR_LAYOUTS_TARBALL
echo " done"
echo -n "clone repo cldr2json..."
git clone -q --depth=1 $CLDR2JSON_GIT
echo " done"
echo -n "unpacking ${ARCHIVE}..."
unzip -qq ${ARCHIVE} "*android.xml"
echo " done"

# create dest dir
if [ ! -d $destdir/osk-layouts ]; then
  echo "create $destdir/osk-layouts dir"
  mkdir "$destdir/osk-layouts"
fi


mkdir osk-layouts
layouts2="$(find keyboards/android/ -name "*android.xml" -exec basename {} -t-k0-android.xml \;|tr '\n' ' ')"
for l in $layouts2 ; do
  if [[ "${EXCLUDE[@]}" =~ "$l" ]] ; then
    continue;
  fi

  #echo "layout: $l"
  cldr="${l}-t-k0-android.xml"

  # transform to JSON file
  $CLDR2JSON keyboards/android/$cldr osk-layouts
done

# copy only modified files
rsync -rc --info=name osk-layouts $destdir

# Generate new gresources xml file
cat >$GRESOURCE_FILE <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/org/gnome/shell/osk-layouts">
EOF

for f in $destdir/osk-layouts/*.json
do
    echo "    <file>$(basename $f)</file>" >>$GRESOURCE_FILE
done

cat >>$GRESOURCE_FILE <<EOF
    <file>emoji.json</file>
  </gresource>
</gresources>
EOF

# Rewrite old gresources xml
mv $GRESOURCE_FILE $destdir/$GRESOURCE_FILE

popd
echo "delete $workdir dir"
rm -rf $workdir
