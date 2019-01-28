// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const { Clutter, Gio, GLib, GObject, Meta, Shell, St } = imports.gi;
const Gettext = imports.gettext;
const Signals = imports.signals;

const KeyboardManager = imports.misc.keyboardManager;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const SwitcherPopup = imports.ui.switcherPopup;
const Util = imports.misc.util;

const INPUT_SOURCE_TYPE_XKB = 'xkb';

var LayoutMenuItem = GObject.registerClass(
class LayoutMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(displayName, shortName) {
        super._init();

        this.label = new St.Label({ text: displayName });
        this.indicator = new St.Label({ text: shortName });
        this.add(this.label, { expand: true });
        this.add(this.indicator);
        this.label_actor = this.label;
    }
});

var InputSource = class {
    constructor(type, id, displayName, shortName, index) {
        this.type = type;
        this.id = id;
        this.displayName = displayName;
        this._shortName = shortName;
        this.index = index;

        this.properties = null;

        this.xkbId = this._getXkbId();
    }

    get shortName() {
        return this._shortName;
    }

    set shortName(v) {
        this._shortName = v;
        this.emit('changed');
    }

    activate(interactive) {
        this.emit('activate', !!interactive);
    }

    _getXkbId() {
        return this.id;
    }
};
Signals.addSignalMethods(InputSource.prototype);

var InputSourcePopup = GObject.registerClass(
class InputSourcePopup extends SwitcherPopup.SwitcherPopup {
    _init(items, action, actionBackward) {
        super._init(items);

        this._action = action;
        this._actionBackward = actionBackward;

        this._switcherList = new InputSourceSwitcher(this._items);
    }

    _keyPressHandler(keysym, action) {
        if (action == this._action)
            this._select(this._next());
        else if (action == this._actionBackward)
            this._select(this._previous());
        else if (keysym == Clutter.Left)
            this._select(this._previous());
        else if (keysym == Clutter.Right)
            this._select(this._next());
        else
            return Clutter.EVENT_PROPAGATE;

        return Clutter.EVENT_STOP;
    }

    _finish() {
        super._finish();

        this._items[this._selectedIndex].activate(true);
    }
});

var InputSourceSwitcher = GObject.registerClass(
class InputSourceSwitcher extends SwitcherPopup.SwitcherList {
    _init(items) {
        super._init(true);

        for (let i = 0; i < items.length; i++)
            this._addIcon(items[i]);
    }

    _addIcon(item) {
        let box = new St.BoxLayout({ vertical: true });

        let bin = new St.Bin({ style_class: 'input-source-switcher-symbol' });
        let symbol = new St.Label({ text: item.shortName });
        bin.set_child(symbol);
        box.add(bin, { x_fill: false, y_fill: false } );

        let text = new St.Label({ text: item.displayName });
        box.add(text, { x_fill: false });

        this.addItem(box, text);
    }
});

var InputSourceSettings = class {
    constructor() {
        if (this.constructor === InputSourceSettings)
            throw new TypeError(`Cannot instantiate abstract class ${this.constructor.name}`);
    }

    _emitInputSourcesChanged() {
        this.emit('input-sources-changed');
    }

    _emitKeyboardOptionsChanged() {
        this.emit('keyboard-options-changed');
    }

    _emitPerWindowChanged() {
        this.emit('per-window-changed');
    }

    get inputSources() {
        return [];
    }

    get mruSources() {
        return [];
    }

    set mruSources(sourcesList) {
        // do nothing
    }

    get keyboardOptions() {
        return [];
    }

    get perWindow() {
        return false;
    }
};
Signals.addSignalMethods(InputSourceSettings.prototype);

var InputSourceSystemSettings = class extends InputSourceSettings {
    constructor() {
        super();

        this._layouts = '';
        this._variants = '';
        this._options = '';
    }

    get inputSources() {
        let sourcesList = [];
        let layouts = this._layouts.split(',');
        let variants = this._variants.split(',');

        for (let i = 0; i < layouts.length && !!layouts[i]; i++) {
            let id = layouts[i];
            if (variants[i])
                id += '+' + variants[i];
            sourcesList.push({ type: INPUT_SOURCE_TYPE_XKB, id: id });
        }
        return sourcesList;
    }

    get keyboardOptions() {
        return this._options.split(',');
    }
};

var InputSourceSessionSettings = class extends InputSourceSettings {
    constructor() {
        super();

        this._DESKTOP_INPUT_SOURCES_SCHEMA = 'org.gnome.desktop.input-sources';
        this._KEY_INPUT_SOURCES = 'sources';
        this._KEY_MRU_SOURCES = 'mru-sources';
        this._KEY_KEYBOARD_OPTIONS = 'xkb-options';
        this._KEY_PER_WINDOW = 'per-window';

        this._settings = new Gio.Settings({ schema_id: this._DESKTOP_INPUT_SOURCES_SCHEMA });
        this._settings.connect('changed::' + this._KEY_INPUT_SOURCES, this._emitInputSourcesChanged.bind(this));
        this._settings.connect('changed::' + this._KEY_KEYBOARD_OPTIONS, this._emitKeyboardOptionsChanged.bind(this));
        this._settings.connect('changed::' + this._KEY_PER_WINDOW, this._emitPerWindowChanged.bind(this));
    }

    _getSourcesList(key) {
        let sourcesList = [];
        let sources = this._settings.get_value(key);
        let nSources = sources.n_children();

        for (let i = 0; i < nSources; i++) {
            let [type, id] = sources.get_child_value(i).deep_unpack();
            sourcesList.push({ type: type, id: id });
        }
        return sourcesList;
    }

    get inputSources() {
        return this._getSourcesList(this._KEY_INPUT_SOURCES);
    }

    get mruSources() {
        return this._getSourcesList(this._KEY_MRU_SOURCES);
    }

    set mruSources(sourcesList) {
        let sources = GLib.Variant.new('a(ss)', sourcesList);
        this._settings.set_value(this._KEY_MRU_SOURCES, sources);
    }

    get keyboardOptions() {
        return this._settings.get_strv(this._KEY_KEYBOARD_OPTIONS);
    }

    get perWindow() {
        return this._settings.get_boolean(this._KEY_PER_WINDOW);
    }
};

var InputSourceManager = class {
    constructor() {
        // All valid input sources currently in the gsettings
        // KEY_INPUT_SOURCES list indexed by their index there
        this._inputSources = {};

        this._currentSource = null;

        // All valid input sources currently in the gsettings
        // KEY_INPUT_SOURCES list ordered by most recently used
        this._mruSources = [];
        this._keybindingAction =
            Main.wm.addKeybinding('switch-input-source',
                                  new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings" }),
                                  Meta.KeyBindingFlags.NONE,
                                  Shell.ActionMode.ALL,
                                  this._switchInputSource.bind(this));
        this._keybindingActionBackward =
            Main.wm.addKeybinding('switch-input-source-backward',
                                  new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings" }),
                                  Meta.KeyBindingFlags.IS_REVERSED,
                                  Shell.ActionMode.ALL,
                                  this._switchInputSource.bind(this));
        if (Main.sessionMode.isGreeter)
            this._settings = new InputSourceSystemSettings();
        else
            this._settings = new InputSourceSessionSettings();
        this._settings.connect('input-sources-changed', this._inputSourcesChanged.bind(this));
        this._settings.connect('keyboard-options-changed', this._keyboardOptionsChanged.bind(this));

        this._xkbInfo = KeyboardManager.getXkbInfo();
        this._keyboardManager = KeyboardManager.getKeyboardManager();

        global.display.connect('modifiers-accelerator-activated', this._modifiersSwitcher.bind(this));

        this._sourcesPerWindow = false;
        this._focusWindowNotifyId = 0;
        this._overviewShowingId = 0;
        this._overviewHiddenId = 0;
        this._settings.connect('per-window-changed', this._sourcesPerWindowChanged.bind(this));
        this._sourcesPerWindowChanged();
        this._reloading = false;
    }

    reload() {
        this._reloading = true;
        this._keyboardManager.setKeyboardOptions(this._settings.keyboardOptions);
        this._inputSourcesChanged();
        this._reloading = false;
    }

    _modifiersSwitcher() {
        let sourceIndexes = Object.keys(this._inputSources);
        if (sourceIndexes.length == 0) {
            KeyboardManager.releaseKeyboard();
            return true;
        }

        let is = this._currentSource;
        if (!is)
            is = this._inputSources[sourceIndexes[0]];

        let nextIndex = is.index + 1;
        if (nextIndex > sourceIndexes[sourceIndexes.length - 1])
            nextIndex = 0;

        while (!(is = this._inputSources[nextIndex]))
            nextIndex += 1;

        is.activate(true);
        return true;
    }

    _switchInputSource(display, window, binding) {
        if (this._mruSources.length < 2)
            return;

        // HACK: Fall back on simple input source switching since we
        // can't show a popup switcher while a GrabHelper grab is in
        // effect without considerable work to consolidate the usage
        // of pushModal/popModal and grabHelper. See
        // https://bugzilla.gnome.org/show_bug.cgi?id=695143 .
        if (Main.actionMode == Shell.ActionMode.POPUP) {
            this._modifiersSwitcher();
            return;
        }

        let popup = new InputSourcePopup(this._mruSources, this._keybindingAction, this._keybindingActionBackward);
        if (!popup.show(binding.is_reversed(), binding.get_name(), binding.get_mask()))
            popup.fadeAndDestroy();
    }

    _keyboardOptionsChanged() {
        this._keyboardManager.setKeyboardOptions(this._settings.keyboardOptions);
        this._keyboardManager.reapply();
    }

    _currentInputSourceChanged(newSource) {
        let oldSource;
        [oldSource, this._currentSource] = [this._currentSource, newSource];

        this.emit('current-source-changed', oldSource);

        for (let i = 1; i < this._mruSources.length; ++i)
            if (this._mruSources[i] == newSource) {
                let currentSource = this._mruSources.splice(i, 1);
                this._mruSources = currentSource.concat(this._mruSources);
                break;
            }

        this._changePerWindowSource();
    }

    activateInputSource(is, interactive) {
        // The focus changes during holdKeyboard/releaseKeyboard may trick
        // the client into hiding UI containing the currently focused entry.
        // So holdKeyboard/releaseKeyboard are not called when
        // 'set-content-type' signal is received.
        // E.g. Focusing on a password entry in a popup in Xorg Firefox
        // will emit 'set-content-type' signal.
        // https://gitlab.gnome.org/GNOME/gnome-shell/issues/391
        if (!this._reloading)
            KeyboardManager.holdKeyboard();
        this._keyboardManager.apply(is.xkbId);
        if (!this._reloading)
            KeyboardManager.releaseKeyboard();

        this._currentInputSourceChanged(is);
    }

    _updateMruSources() {
        let sourcesList = [];
        for (let i in this._inputSources)
            sourcesList.push(this._inputSources[i]);

        this._keyboardManager.setUserLayouts(sourcesList.map(x => x.xkbId));

        // Initialize from settings when we have no MRU sources list
        if (this._mruSources.length == 0) {
            let mruSettings = this._settings.mruSources;
            for (let i = 0; i < mruSettings.length; i++) {
                let mruSettingSource = mruSettings[i];
                let mruSource = null;

                for (let j = 0; j < sourcesList.length; j++) {
                    let source = sourcesList[j];
                    if (source.type == mruSettingSource.type &&
                        source.id == mruSettingSource.id) {
                        mruSource = source;
                        break;
                    }
                }

                if (mruSource)
                    this._mruSources.push(mruSource);
            }
        }

        let mruSources = [];
        for (let i = 0; i < this._mruSources.length; i++) {
            for (let j = 0; j < sourcesList.length; j++)
                if (this._mruSources[i].type == sourcesList[j].type &&
                    this._mruSources[i].id == sourcesList[j].id) {
                    mruSources = mruSources.concat(sourcesList.splice(j, 1));
                    break;
                }
        }
        this._mruSources = mruSources.concat(sourcesList);
    }

    _inputSourcesChanged() {
        let sources = this._settings.inputSources;
        let nSources = sources.length;

        this._currentSource = null;
        this._inputSources = {};

        let infosList = [];
        for (let i = 0; i < nSources; i++) {
            let displayName;
            let shortName;
            let type = sources[i].type;
            let id = sources[i].id;
            let exists = false;

            if (type == INPUT_SOURCE_TYPE_XKB) {
                [exists, displayName, shortName] =
                    this._xkbInfo.get_layout_info(id);
            }

            if (exists)
                infosList.push({ type: type, id: id, displayName: displayName, shortName: shortName });
        }

        if (infosList.length == 0) {
            let type = INPUT_SOURCE_TYPE_XKB;
            let id = KeyboardManager.DEFAULT_LAYOUT;
            let [, displayName, shortName] = this._xkbInfo.get_layout_info(id);
            infosList.push({ type: type, id: id, displayName: displayName, shortName: shortName });
        }

        let inputSourcesByShortName = {};
        for (let i = 0; i < infosList.length; i++) {
            let is = new InputSource(infosList[i].type,
                                     infosList[i].id,
                                     infosList[i].displayName,
                                     infosList[i].shortName,
                                     i);
            is.connect('activate', this.activateInputSource.bind(this));

            if (!(is.shortName in inputSourcesByShortName))
                inputSourcesByShortName[is.shortName] = [];
            inputSourcesByShortName[is.shortName].push(is);

            this._inputSources[is.index] = is;
        }

        for (let i in this._inputSources) {
            let is = this._inputSources[i];
            if (inputSourcesByShortName[is.shortName].length > 1) {
                let sub = inputSourcesByShortName[is.shortName].indexOf(is) + 1;
                is.shortName += String.fromCharCode(0x2080 + sub);
            }
        }

        this.emit('sources-changed');

        this._updateMruSources();

        if (this._mruSources.length > 0)
            this._mruSources[0].activate(false);
    }

    _makeEngineShortName(engineDesc) {
        let symbol = engineDesc.get_symbol();
        if (symbol && symbol[0])
            return symbol;

        let langCode = engineDesc.get_language().split('_', 1)[0];
        if (langCode.length == 2 || langCode.length == 3)
            return langCode.toLowerCase();

        return String.fromCharCode(0x2328); // keyboard glyph
    }

    _getNewInputSource(current) {
        let sourceIndexes = Object.keys(this._inputSources);
        if (sourceIndexes.length == 0)
            return null;

        if (current) {
            for (let i in this._inputSources) {
                let is = this._inputSources[i];
                if (is.type == current.type &&
                    is.id == current.id)
                    return is;
            }
        }

        return this._inputSources[sourceIndexes[0]];
    }

    _getCurrentWindow() {
        if (Main.overview.visible)
            return Main.overview;
        else
            return global.display.focus_window;
    }

    _setPerWindowInputSource() {
        let window = this._getCurrentWindow();
        if (!window)
            return;

        if (window._inputSources != this._inputSources) {
            window._inputSources = this._inputSources;
            window._currentSource = this._getNewInputSource(window._currentSource);
        }

        if (window._currentSource)
            window._currentSource.activate(false);
    }

    _sourcesPerWindowChanged() {
        this._sourcesPerWindow = this._settings.perWindow;

        if (this._sourcesPerWindow && this._focusWindowNotifyId == 0) {
            this._focusWindowNotifyId = global.display.connect('notify::focus-window',
                                                               this._setPerWindowInputSource.bind(this));
            this._overviewShowingId = Main.overview.connect('showing',
                                                            this._setPerWindowInputSource.bind(this));
            this._overviewHiddenId = Main.overview.connect('hidden',
                                                           this._setPerWindowInputSource.bind(this));
        } else if (!this._sourcesPerWindow && this._focusWindowNotifyId != 0) {
            global.display.disconnect(this._focusWindowNotifyId);
            this._focusWindowNotifyId = 0;
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = 0;
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = 0;

            let windows = global.get_window_actors().map(w => w.meta_window);
            for (let i = 0; i < windows.length; ++i) {
                delete windows[i]._inputSources;
                delete windows[i]._currentSource;
            }
            delete Main.overview._inputSources;
            delete Main.overview._currentSource;
        }
    }

    _changePerWindowSource() {
        if (!this._sourcesPerWindow)
            return;

        let window = this._getCurrentWindow();
        if (!window)
            return;

        window._inputSources = this._inputSources;
        window._currentSource = this._currentSource;
    }

    get currentSource() {
        return this._currentSource;
    }

    get inputSources() {
        return this._inputSources;
    }
};
Signals.addSignalMethods(InputSourceManager.prototype);

let _inputSourceManager = null;

function getInputSourceManager() {
    if (_inputSourceManager == null)
        _inputSourceManager = new InputSourceManager();
    return _inputSourceManager;
}

var InputSourceIndicatorContainer = GObject.registerClass(
class InputSourceIndicatorContainer extends St.Widget {

    vfunc_get_preferred_width(forHeight) {
        // Here, and in vfunc_get_preferred_height, we need to query
        // for the height of all children, but we ignore the results
        // for those we don't actually display.
        return this.get_children().reduce((maxWidth, child) => {
            let width = child.get_preferred_width(forHeight);
            return [Math.max(maxWidth[0], width[0]),
                    Math.max(maxWidth[1], width[1])];
        }, [0, 0]);
    }

    vfunc_get_preferred_height(forWidth) {
        return this.get_children().reduce((maxHeight, child) => {
            let height = child.get_preferred_height(forWidth);
            return [Math.max(maxHeight[0], height[0]),
                    Math.max(maxHeight[1], height[1])];
        }, [0, 0]);
    }

    vfunc_allocate(box, flags) {
        this.set_allocation(box, flags);

        // translate box to (0, 0)
        box.x2 -= box.x1;
        box.x1 = 0;
        box.y2 -= box.y1;
        box.y1 = 0;

        this.get_children().forEach(c => {
            c.allocate_align_fill(box, 0.5, 0.5, false, false, flags);
        });
    }
});

var InputSourceIndicator = GObject.registerClass(
class InputSourceIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, _("Keyboard"));

        this.connect('destroy', this._onDestroy.bind(this));

        this._menuItems = {};
        this._indicatorLabels = {};

        this._container = new InputSourceIndicatorContainer();

        this._hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._hbox.add_child(this._container);
        this._hbox.add_child(PopupMenu.arrowIcon(St.Side.BOTTOM));

        this.add_child(this._hbox);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._showLayoutItem = this.menu.addAction(_("Show Keyboard Layout"), this._showLayout.bind(this));

        Main.sessionMode.connect('updated', this._sessionUpdated.bind(this));
        this._sessionUpdated();

        this._inputSourceManager = getInputSourceManager();
        this._inputSourceManagerSourcesChangedId =
            this._inputSourceManager.connect('sources-changed', this._sourcesChanged.bind(this));
        this._inputSourceManagerCurrentSourceChangedId =
            this._inputSourceManager.connect('current-source-changed', this._currentSourceChanged.bind(this));
        this._inputSourceManager.reload();
    }

    _onDestroy() {
        if (this._inputSourceManager) {
            this._inputSourceManager.disconnect(this._inputSourceManagerSourcesChangedId);
            this._inputSourceManager.disconnect(this._inputSourceManagerCurrentSourceChangedId);
            this._inputSourceManager = null;
        }
    }

    _sessionUpdated() {
        // re-using "allowSettings" for the keyboard layout is a bit shady,
        // but at least for now it is used as "allow popping up windows
        // from shell menus"; we can always add a separate sessionMode
        // option if need arises.
        this._showLayoutItem.visible = Main.sessionMode.allowSettings;
    }

    _sourcesChanged() {
        for (let i in this._menuItems)
            this._menuItems[i].destroy();
        for (let i in this._indicatorLabels)
            this._indicatorLabels[i].destroy();

        this._menuItems = {};
        this._indicatorLabels = {};

        let menuIndex = 0;
        for (let i in this._inputSourceManager.inputSources) {
            let is = this._inputSourceManager.inputSources[i];

            let menuItem = new LayoutMenuItem(is.displayName, is.shortName);
            menuItem.connect('activate', () => is.activate(true));

            let indicatorLabel = new St.Label({ text: is.shortName,
                                                visible: false });

            this._menuItems[i] = menuItem;
            this._indicatorLabels[i] = indicatorLabel;
            is.connect('changed', () => {
                menuItem.indicator.set_text(is.shortName);
                indicatorLabel.set_text(is.shortName);
            });

            this.menu.addMenuItem(menuItem, menuIndex++);
            this._container.add_actor(indicatorLabel);
        }
    }

    _currentSourceChanged(manager, oldSource) {
        let nVisibleSources = Object.keys(this._inputSourceManager.inputSources).length;
        let newSource = this._inputSourceManager.currentSource;

        if (oldSource) {
            this._menuItems[oldSource.index].setOrnament(PopupMenu.Ornament.NONE);
            this._indicatorLabels[oldSource.index].hide();
        }

        if (!newSource || (nVisibleSources < 2)) {
            // This source index might be invalid if we weren't able
            // to build a menu item for it, so we hide ourselves since
            // we can't fix it here. *shrug*

            this.menu.close();
            this.hide();
            return;
        }

        this.show();

        this._menuItems[newSource.index].setOrnament(PopupMenu.Ornament.DOT);
        this._indicatorLabels[newSource.index].show();
    }

    _showLayout() {
        Main.overview.hide();

        let source = this._inputSourceManager.currentSource;
        let xkbLayout = '';
        let xkbVariant = '';

        if (source.type == INPUT_SOURCE_TYPE_XKB) {
            [, , , xkbLayout, xkbVariant] = KeyboardManager.getXkbInfo().get_layout_info(source.id);
        }

        if (!xkbLayout || xkbLayout.length == 0)
            return;

        let description = xkbLayout;
        if (xkbVariant.length > 0)
            description = description + '\t' + xkbVariant;

        Util.spawn(['gkbd-keyboard-display', '-l', description]);
    }
});
