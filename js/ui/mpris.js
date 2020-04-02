const { Clutter, Gio, GObject, Shell, St } = imports.gi;
const Signals = imports.signals;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const { loadInterfaceXML } = imports.misc.fileUtils;

const DBusIface = loadInterfaceXML('org.freedesktop.DBus');
const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusIface);

const MprisIface = loadInterfaceXML('org.mpris.MediaPlayer2');
const MprisProxy = Gio.DBusProxy.makeProxyWrapper(MprisIface);

const MprisPlayerIface = loadInterfaceXML('org.mpris.MediaPlayer2.Player');
const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(MprisPlayerIface);

const MPRIS_PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';

const BUTTON_PREV = 8;
const BUTTON_NEXT = 9;

var MediaState = GObject.registerClass(
class MediaState extends PanelMenu.Button
{
    _init(player)
    {
        super._init(0.0, 'MPlayer');

        this._icon = new St.Icon(
        {
            style_class: 'system-status-icon',
            icon_name: 'multimedia-player-symbolic',
            icon_size: 24
        });
        this._icon.style = 'icon-shadow: none';

        this.add_actor(this._icon);

        Main.panel.addToStatusArea('mplayer-indicator', this, 1);

        this._player = player;

        this.addItem(C_('mpris', 'Play'), () => this._player.play());
        this.addItem(C_('mpris', 'Pause'), () => this._player.pause());
        this.addItem(C_('mpris', 'Stop'), () => this._player.stop());
        this.addItem(C_('mpris', 'Previous'), () => this._player.previous());
        this.addItem(C_('mpris', 'Next'), () => this._player.next());
        this.addItem('--');
        this.addItem(C_('mpris', 'Quit'), () => this._player.quit());
        this.hide();

        this._state = false;

        this._updateId = this._player.connect('changed', this._update.bind(this));
        this._player.connect('closed', this._close.bind(this));
        this._update();
    }

    setIcon(name)
    {
        this._icon.icon_name = name + '-symbolic';
    }

    addItem(name, cmd)
    {
        let item;

        if (!name)
            return;

        if (cmd)
        {
            item = new PopupMenu.PopupMenuItem(name);
            item.connect('activate', () => cmd());
        }
        else
            item = new PopupMenu.PopupSeparatorMenuItem();

        this.menu.addMenuItem(item);
    }

    _update()
    {
        let icon;

        if (this._state)
            return;

        icon = this._player.icon;
        if (icon)
            this.setIcon(icon);

        this.show();
    }

    _onEvent(actor, event)
    {
        let type;

        if (!this.menu || !this._player)
            return Clutter.EVENT_PROPAGATE;

        type = event.type();
        if (type != Clutter.EventType.BUTTON_PRESS)
            return;

        switch (event.get_button())
        {
            case Clutter.BUTTON_PRIMARY:
                this._player.raise();
                break;

            case Clutter.BUTTON_MIDDLE:
                this._player.playPause();
                break;

            case Clutter.BUTTON_SECONDARY:
                this.menu.toggle();
                break;

            case BUTTON_PREV:
                this._player.previous();
                break;

            case BUTTON_NEXT:
                this._player.next();
                break;
        }
    }

    _close()
    {
        if (!this._state)
            return;

        this.hide();
    }

    destroy()
    {
        if (this._updateId != 0)
        {
            this._player.disconnect(this._updateId);
            this._updateId = 0;
        }

        super.destroy();
    }
});

var MprisPlayer = class MprisPlayer {
    constructor(busName) {
        this._mprisProxy = new MprisProxy(Gio.DBus.session, busName,
                                          '/org/mpris/MediaPlayer2',
                                          this._onMprisProxyReady.bind(this));
        this._playerProxy = new MprisPlayerProxy(Gio.DBus.session, busName,
                                                 '/org/mpris/MediaPlayer2',
                                                 this._onPlayerProxyReady.bind(this));

        this._visible = false;
        this._trackArtists = [];
        this._trackTitle = '';
        this._trackCoverUrl = '';
        this._iconName = null;
    }

    get status() {
        return this._playerProxy.PlaybackStatus;
    }

    get trackArtists() {
        return this._trackArtists;
    }

    get trackTitle() {
        return this._trackTitle;
    }

    get trackCoverUrl() {
        return this._trackCoverUrl;
    }

    get icon() {
        if (this._iconName)
            return this._iconName;

        let app = null;
        if (!this._mprisProxy.DesktopEntry)
            return null;

        let desktopId = this._mprisProxy.DesktopEntry + '.desktop';
        app = Shell.AppSystem.get_default().lookup_app(desktopId);
        if (!app)
            return null;

        app = app.get_app_info();
        if (!app)
            return null;

        this._iconName = app.get_string('Icon');

        return this._iconName;
    }

    pause() {
        this._playerProxy.PauseRemote();
    }

    playPause() {
        this._playerProxy.PlayPauseRemote();
    }

    stop() {
        this._playerProxy.StopRemote();
    }

    play() {
        this._playerProxy.PlayRemote();
    }

    get canGoNext() {
        return this._playerProxy.CanGoNext;
    }

    next() {
        this._playerProxy.NextRemote();
    }

    get canGoPrevious() {
        return this._playerProxy.CanGoPrevious;
    }

    previous() {
        this._playerProxy.PreviousRemote();
    }

    _toggleWin(app)
    {
        let wins, state;

        state = app.get_state();
        if (state != Shell.AppState.RUNNING)
        {
            app.activate();
            return;
        }

        wins = app.get_windows();
        if (!wins || wins.length <= 0)
        {
            app.activate();
            return;
        }

        if (wins[0].showing_on_its_workspace())
            wins[0].delete(global.get_current_time());
        else
            wins[0].activate(global.get_current_time());
    }

    raise() {
        // The remote Raise() method may run into focus stealing prevention,
        // so prefer activating the app via .desktop file if possible
        let app = null;
        if (this._mprisProxy.DesktopEntry) {
            let desktopId = this._mprisProxy.DesktopEntry + '.desktop';
            app = Shell.AppSystem.get_default().lookup_app(desktopId);
        }

        if (app)
            this._toggleWin(app);
        else if (this._mprisProxy.CanRaise)
            this._mprisProxy.RaiseRemote();
    }
    
    quit() {
        if (this._mprisProxy.CanQuit)
            this._mprisProxy.QuitRemote();
    }

    _close() {
        this._mprisProxy.disconnect(this._ownerNotifyId);
        this._mprisProxy = null;

        this._playerProxy.disconnect(this._propsChangedId);
        this._playerProxy = null;

        this.emit('closed');
    }

    _onMprisProxyReady() {
        this._ownerNotifyId = this._mprisProxy.connect('notify::g-name-owner',
            () => {
                if (!this._mprisProxy.g_name_owner)
                    this._close();
            });
    }

    _onPlayerProxyReady() {
        this._propsChangedId = this._playerProxy.connect('g-properties-changed',
                                                         this._updateState.bind(this));
        this._updateState();
    }

    _updateState() {
        let metadata = {};
        for (let prop in this._playerProxy.Metadata)
            metadata[prop] = this._playerProxy.Metadata[prop].deep_unpack();

        this._trackArtists = metadata['xesam:artist'] || [_("Unknown artist")];
        this._trackTitle = metadata['xesam:title'] || _("Unknown title");
        this._trackCoverUrl = metadata['mpris:artUrl'] || '';
        this.emit('changed');

        let visible = this._playerProxy.CanPlay;

        if (this._visible != visible) {
            this._visible = visible;
            if (visible)
                this.emit('show');
            else
                this._close();
        }
    }
};
Signals.addSignalMethods(MprisPlayer.prototype);

var Media = class Media {
    constructor() {
        this._players = new Map();

        this._proxy = new DBusProxy(Gio.DBus.session,
                                    'org.freedesktop.DBus',
                                    '/org/freedesktop/DBus',
                                    this._onProxyReady.bind(this));
    }

    _addPlayer(busName) {
        if (this._players.get(busName))
            return;

        let player = new MprisPlayer(busName);
        player.connect('closed',
            () => {
                var state;

                state = this._players.get(busName);
                if (state)
                {
                    state.destroy();
                    state = null;
                    this._players.delete(busName);
                }
            });
        this._players.set(busName, new MediaState(player));
    }

    _onProxyReady() {
        this._proxy.ListNamesRemote(([names]) => {
            names.forEach(name => {
                if (!name.startsWith(MPRIS_PLAYER_PREFIX))
                    return;

                this._addPlayer(name);
            });
        });
        this._proxy.connectSignal('NameOwnerChanged',
                                  this._onNameOwnerChanged.bind(this));
    }

    _onNameOwnerChanged(proxy, sender, [name, oldOwner, newOwner]) {
        if (!name.startsWith(MPRIS_PLAYER_PREFIX))
            return;

        if (newOwner && !oldOwner)
            this._addPlayer(name);
    }

    destroy()
    {
        this._players.forEach(state =>
        {
            state.destroy();
            state = null;
        });
        this._players.clear();
    }
};
