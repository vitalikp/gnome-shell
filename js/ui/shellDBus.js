// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const { Gio, GLib, Meta, Shell } = imports.gi;
const Lang = imports.lang;

const Config = imports.misc.config;
const ExtensionSystem = imports.ui.extensionSystem;
const ExtensionDownloader = imports.ui.extensionDownloader;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const Screenshot = imports.ui.screenshot;

const { loadInterfaceXML } = imports.misc.fileUtils;

const GnomeShellIface = loadInterfaceXML('org.gnome.Shell');
const ScreenSaverIface = loadInterfaceXML('org.gnome.ScreenSaver');

var GnomeShell = class {
    constructor() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(GnomeShellIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell');

        this._extensionsService = new GnomeShellExtensions();
        this._screenshotService = new Screenshot.ScreenshotService();

        this._grabbedAccelerators = new Map();
        this._grabbers = new Map();

        global.display.connect('accelerator-activated',
            (display, action, device, timestamp) => {
                this._emitAcceleratorActivated(action, device, timestamp);
            });

        this._cachedOverviewVisible = false;
        Main.overview.connect('showing',
                              this._checkOverviewVisibleChanged.bind(this));
        Main.overview.connect('hidden',
                              this._checkOverviewVisibleChanged.bind(this));
    }

    /**
     * Eval:
     * @code: A string containing JavaScript code
     *
     * This function executes arbitrary code in the main
     * loop, and returns a boolean success and
     * JSON representation of the object as a string.
     *
     * If evaluation completes without throwing an exception,
     * then the return value will be [true, JSON.stringify(result)].
     * If evaluation fails, then the return value will be
     * [false, JSON.stringify(exception)];
     *
     */
    Eval(code) {
        if (!global.settings.get_boolean('development-tools'))
            return [false, ''];

        let returnValue;
        let success;
        try {
            returnValue = JSON.stringify(eval(code));
            // A hack; DBus doesn't have null/undefined
            if (returnValue == undefined)
                returnValue = '';
            success = true;
        } catch (e) {
            returnValue = `${e}`;
            success = false;
        }
        return [success, returnValue];
    }

    FocusSearch() {
        Main.overview.focusSearch();
    }

    ShowOSD(params) {
        for (let param in params)
            params[param] = params[param].deep_unpack();

        let { connector,
              label,
              level,
              max_level: maxLevel,
              icon: serializedIcon } = params;

        let monitorIndex = -1;
        if (connector) {
            let monitorManager = Meta.MonitorManager.get();
            monitorIndex = monitorManager.get_monitor_for_connector(connector);
        }

        let icon = null;
        if (serializedIcon)
            icon = Gio.Icon.new_for_string(serializedIcon);

        Main.osdWindowManager.show(monitorIndex, icon, label, level, maxLevel);
    }

    FocusApp(id) {
        this.ShowApplications();
        Main.overview.viewSelector.appDisplay.selectApp(id);
    }

    ShowApplications() {
        Main.overview.viewSelector.showApps();
    }

    GrabAcceleratorAsync(params, invocation) {
        let [accel, modeFlags, grabFlags] = params;
        let sender = invocation.get_sender();
        let bindingAction = this._grabAcceleratorForSender(accel, modeFlags, grabFlags, sender);
        return invocation.return_value(GLib.Variant.new('(u)', [bindingAction]));
    }

    GrabAcceleratorsAsync(params, invocation) {
        let [accels] = params;
        let sender = invocation.get_sender();
        let bindingActions = [];
        for (let i = 0; i < accels.length; i++) {
            let [accel, modeFlags, grabFlags] = accels[i];
            bindingActions.push(this._grabAcceleratorForSender(accel, modeFlags, grabFlags, sender));
        }
        return invocation.return_value(GLib.Variant.new('(au)', [bindingActions]));
    }

    UngrabAcceleratorAsync(params, invocation) {
        let [action] = params;
        let sender = invocation.get_sender();
        let ungrabSucceeded = this._ungrabAcceleratorForSender(action, sender);

        return invocation.return_value(GLib.Variant.new('(b)', [ungrabSucceeded]));
    }

    UngrabAcceleratorsAsync(params, invocation) {
        let [actions] = params;
        let sender = invocation.get_sender();
        let ungrabSucceeded = true;

        for (let i = 0; i < actions.length; i++)
            ungrabSucceeded &= this._ungrabAcceleratorForSender(actions[i], sender);

        return invocation.return_value(GLib.Variant.new('(b)', [ungrabSucceeded]));
    }

    _emitAcceleratorActivated(action, device, timestamp) {
        let destination = this._grabbedAccelerators.get(action);
        if (!destination)
            return;

        let connection = this._dbusImpl.get_connection();
        let info = this._dbusImpl.get_info();
        let params = { 'device-id': GLib.Variant.new('u', device.get_device_id()),
                       'device-node': GLib.Variant.new('s', device.get_device_node()),
                       'timestamp': GLib.Variant.new('u', timestamp),
                       'action-mode': GLib.Variant.new('u', Main.actionMode) };
        connection.emit_signal(destination,
                               this._dbusImpl.get_object_path(),
                               info ? info.name : null,
                               'AcceleratorActivated',
                               GLib.Variant.new('(ua{sv})', [action, params]));
    }

    _grabAcceleratorForSender(accelerator, modeFlags, grabFlags, sender) {
        let bindingAction = global.display.grab_accelerator(accelerator, grabFlags);
        if (bindingAction == Meta.KeyBindingAction.NONE)
            return Meta.KeyBindingAction.NONE;

        let bindingName = Meta.external_binding_name_for_action(bindingAction);
        Main.wm.allowKeybinding(bindingName, modeFlags);

        this._grabbedAccelerators.set(bindingAction, sender);

        if (!this._grabbers.has(sender)) {
            let id = Gio.bus_watch_name(Gio.BusType.SESSION, sender, 0, null,
                                        this._onGrabberBusNameVanished.bind(this));
            this._grabbers.set(sender, id);
        }

        return bindingAction;
    }

    _ungrabAccelerator(action) {
        let ungrabSucceeded = global.display.ungrab_accelerator(action);
        if (ungrabSucceeded)
            this._grabbedAccelerators.delete(action);

        return ungrabSucceeded;
    }

    _ungrabAcceleratorForSender(action, sender) {
        let grabbedBy = this._grabbedAccelerators.get(action);
        if (sender != grabbedBy)
            return false;

        return this._ungrabAccelerator(action);
    }

    _onGrabberBusNameVanished(connection, name) {
        let grabs = this._grabbedAccelerators.entries();
        for (let [action, sender] of grabs) {
            if (sender == name)
                this._ungrabAccelerator(action);
        }
        Gio.bus_unwatch_name(this._grabbers.get(name));
        this._grabbers.delete(name);
    }

    ShowMonitorLabels2Async(params, invocation) {
        let sender = invocation.get_sender();
        let [dict] = params;
        Main.osdMonitorLabeler.show(sender, dict);
    }

    HideMonitorLabelsAsync(params, invocation) {
        let sender = invocation.get_sender();
        Main.osdMonitorLabeler.hide(sender);
    }

    _checkOverviewVisibleChanged() {
        if (Main.overview.visible !== this._cachedOverviewVisible) {
            this._cachedOverviewVisible = Main.overview.visible;
            this._dbusImpl.emit_property_changed('OverviewActive', new GLib.Variant('b', this._cachedOverviewVisible));
        }
    }

    get Mode() {
        return global.session_mode;
    }

    get OverviewActive() {
        return this._cachedOverviewVisible;
    }

    set OverviewActive(visible) {
        if (visible)
            Main.overview.show();
        else
            Main.overview.hide();
    }

    get ShellVersion() {
        return Config.PACKAGE_VERSION;
    }
};

const GnomeShellExtensionsIface = loadInterfaceXML('org.gnome.Shell.Extensions');

var GnomeShellExtensions = class {
    constructor() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(GnomeShellExtensionsIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell');
        ExtensionSystem.connect('extension-state-changed',
                                this._extensionStateChanged.bind(this));
    }

    ListExtensions() {
        let out = {};
        for (let uuid in ExtensionUtils.extensions) {
            let dbusObj = this.GetExtensionInfo(uuid);
            out[uuid] = dbusObj;
        }
        return out;
    }

    GetExtensionInfo(uuid) {
        let extension = ExtensionUtils.extensions[uuid];
        if (!extension)
            return {};

        let obj = {};
        Lang.copyProperties(extension.metadata, obj);

        // Only serialize the properties that we actually need.
        const serializedProperties = ["type", "state", "path", "error", "hasPrefs"];

        serializedProperties.forEach(prop => {
            obj[prop] = extension[prop];
        });

        let out = {};
        for (let key in obj) {
            let val = obj[key];
            let type;
            switch (typeof val) {
            case 'string':
                type = 's';
                break;
            case 'number':
                type = 'd';
                break;
            case 'boolean':
                type = 'b';
                break;
            default:
                continue;
            }
            out[key] = GLib.Variant.new(type, val);
        }

        return out;
    }

    GetExtensionErrors(uuid) {
        let extension = ExtensionUtils.extensions[uuid];
        if (!extension)
            return [];

        if (!extension.errors)
            return [];

        return extension.errors;
    }

    InstallRemoteExtensionAsync([uuid], invocation) {
        return ExtensionDownloader.installExtension(uuid, invocation);
    }

    UninstallExtension(uuid) {
        return ExtensionDownloader.uninstallExtension(uuid);
    }

    LaunchExtensionPrefs(uuid) {
        let appSys = Shell.AppSystem.get_default();
        let app = appSys.lookup_app('gnome-shell-extension-prefs.desktop');
        let info = app.get_app_info();
        let timestamp = global.display.get_current_time_roundtrip();
        info.launch_uris(['extension:///' + uuid],
                         global.create_app_launch_context(timestamp, -1));
    }

    ReloadExtension(uuid) {
        let extension = ExtensionUtils.extensions[uuid];
        if (!extension)
            return;

        ExtensionSystem.reloadExtension(extension);
    }

    CheckForUpdates() {
        ExtensionDownloader.checkForUpdates();
    }

    get ShellVersion() {
        return Config.PACKAGE_VERSION;
    }

    _extensionStateChanged(_, newState) {
        this._dbusImpl.emit_signal('ExtensionStatusChanged',
                                   GLib.Variant.new('(sis)', [newState.uuid, newState.state, newState.error]));
    }
};

var ScreenSaverDBus = class {
    constructor(screenShield) {
        this._screenShield = screenShield;
        screenShield.connect('active-changed', shield => {
            this._dbusImpl.emit_signal('ActiveChanged', GLib.Variant.new('(b)', [shield.active]));
        });
        screenShield.connect('wake-up-screen', shield => {
            this._dbusImpl.emit_signal('WakeUpScreen', null);
        });

        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(ScreenSaverIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/ScreenSaver');

        Gio.DBus.session.own_name('org.gnome.ScreenSaver', Gio.BusNameOwnerFlags.REPLACE, null, null);
    }

    LockAsync(parameters, invocation) {
        let tmpId = this._screenShield.connect('lock-screen-shown', () => {
            this._screenShield.disconnect(tmpId);

            invocation.return_value(null);
        });

        this._screenShield.lock(true);
    }

    SetActive(active) {
        if (active)
            this._screenShield.activate(true);
        else
            this._screenShield.deactivate(false);
    }

    GetActive() {
        return this._screenShield.active;
    }

    GetActiveTime() {
        let started = this._screenShield.activationTime;
        if (started > 0)
            return Math.floor((GLib.get_monotonic_time() - started) / 1000000);
        else
            return 0;
    }
};
