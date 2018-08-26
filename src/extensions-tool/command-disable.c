/* command-disable.c
 *
 * Copyright 2018 Florian Müllner <fmuellner@gnome.org>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

#include <glib/gi18n.h>
#include <gio/gio.h>

#include "commands.h"
#include "common.h"
#include "config.h"

static gboolean
disable_extension (const char *uuid)
{
  g_autoptr(GSettings) settings = get_shell_settings ();
  g_auto(GStrv) extensions = NULL;
  g_auto(GStrv) new_value = NULL;
  const char **s;
  guint n_extensions;
  int i;

  if (settings == NULL)
    return FALSE;

  if (!g_settings_is_writable (settings, "enabled-extensions"))
    return FALSE;

  extensions = g_settings_get_strv (settings, "enabled-extensions");

  if (!g_strv_contains ((const char **)extensions, uuid))
    return TRUE;

  n_extensions = g_strv_length (extensions);
  new_value = g_new0 (char *, n_extensions);
  for (i = 0, s = (const char **)extensions; i < n_extensions; i++, s++)
    if (!g_str_equal (*s, uuid))
      new_value[i] = g_strdup (*s);

  g_settings_set_strv (settings, "enabled-extensions", (const char **)new_value);
  g_settings_sync ();

  return TRUE;
}

int
handle_disable (int argc, char *argv[], gboolean do_help)
{
  g_autoptr (GOptionContext) context = NULL;
  g_autoptr (GError) error = NULL;
  g_auto(GStrv) uuids = NULL;
  GOptionEntry entries[] = {
    { .long_name = G_OPTION_REMAINING,
      .arg_description = "UUID",
      .arg = G_OPTION_ARG_STRING_ARRAY, .arg_data = &uuids },
    { NULL }
  };

  g_set_prgname ("gnome-extensions disable");

  context = g_option_context_new (NULL);
  g_option_context_set_help_enabled (context, FALSE);
  g_option_context_set_summary (context, _("Disable an extension"));
  g_option_context_add_main_entries (context, entries, GETTEXT_PACKAGE);

  if (do_help)
    {
      show_help (context, NULL);
      return 0;
    }

  if (!g_option_context_parse (context, &argc, &argv, &error))
    {
      show_help (context, error->message);
      return 1;
    }

  if (uuids == NULL)
    {
      show_help (context, _("No UUID given"));
      return 1;
    }
  else if (g_strv_length (uuids) > 1)
    {
      show_help (context, _("More than one UUID given"));
      return 1;
    }

  return disable_extension (*uuids) ? 0 : 2;
}
