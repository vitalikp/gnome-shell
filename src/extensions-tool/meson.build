config_h = configuration_data()
config_h.set_quoted('GETTEXT_PACKAGE', meson.project_name())
config_h.set_quoted('VERSION', meson.project_version())
config_h.set_quoted('LOCALEDIR', localedir)
config_h.set('HAVE_BIND_TEXTDOMAIN_CODESET', cc.has_function('bind_textdomain_codeset'))
configure_file(
  output: 'config.h',
  configuration: config_h,
)

sources = [
  'command-create.c',
  'command-disable.c',
  'command-enable.c',
  'command-info.c',
  'command-install.c',
  'command-list.c',
  'command-pack.c',
  'command-prefs.c',
  'command-reset.c',
  'command-uninstall.c',
  'main.c'
]

resources = gnome.compile_resources('resources',
  'gnome-extensions-tool.gresource.xml',
  source_dir: '.'
)

executable('gnome-extensions',
  sources, resources,
  dependencies: [gio_dep, gio_unix_dep, autoar_dep, json_dep],
  install: true
)

if bash_completion.found()
  install_data('completion/bash/gnome-extensions',
    install_dir: bash_completion.get_pkgconfig_variable('completionsdir')
  )
endif

if get_option('man')
  subdir('man')
endif
