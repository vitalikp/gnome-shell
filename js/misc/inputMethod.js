// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
const Clutter = imports.gi.Clutter;
const Keyboard = imports.ui.status.keyboard;
const Lang = imports.lang;
const Signals = imports.signals;

var InputMethod = new Lang.Class({
    Name: 'InputMethod',
    Extends: Clutter.InputMethod,

    _init() {
        this.parent();
        this._enabled = true;
        this._currentFocus = null;

        this._inputSourceManager = Keyboard.getInputSourceManager();
        this._sourceChangedId = this._inputSourceManager.connect('current-source-changed',
                                                                 this._onSourceChanged.bind(this));
        this._currentSource = this._inputSourceManager.currentSource;
    },

    get currentFocus() {
        return this._currentFocus;
    },

    _onSourceChanged() {
        this._currentSource = this._inputSourceManager.currentSource;
    },

    _onConnected() {
    },

    _clear() {
        this._enabled = false;
    },

    _onCommitText(context, text) {
        this.commit(text.get_text());
    },

    _onDeleteSurroundingText(context) {
        this.delete_surrounding();
    },

    vfunc_focus_in(focus) {
        this._currentFocus = focus;
    },

    vfunc_focus_out() {
        this._currentFocus = null;

        // Unset any preedit text
        this.set_preedit_text(null, 0);
    },

    vfunc_reset() {
        // Unset any preedit text
        this.set_preedit_text(null, 0);
    },

    vfunc_filter_key_event(event) {
        if (!this._enabled)
            return false;
        if (!this._currentSource)
            return false;

        return true;
    },
});
