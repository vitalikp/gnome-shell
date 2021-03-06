// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
/* exported DateMenuButton */

const { Clutter, GLib, GnomeDesktop,
        GObject, Shell, St } = imports.gi;

const Util = imports.misc.util;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const Calendar = imports.ui.calendar;
const System = imports.system;

function _isToday(date) {
    let now = new Date();
    return now.getYear() == date.getYear() &&
           now.getMonth() == date.getMonth() &&
           now.getDate() == date.getDate();
}

var TodayButton = class TodayButton {
    constructor(calendar) {
        // Having the ability to go to the current date if the user is already
        // on the current date can be confusing. So don't make the button reactive
        // until the selected date changes.
        this.actor = new St.Button({
            style_class: 'datemenu-today-button',
            x_align: St.Align.START,
            x_expand: true,
            can_focus: true,
            reactive: false,
        });
        this.actor.connect('clicked', () => {
            this._calendar.setDate(new Date(), false);
        });

        let hbox = new St.BoxLayout({ vertical: true });
        this.actor.add_actor(hbox);

        this._dayLabel = new St.Label({ style_class: 'day-label',
                                        x_align: Clutter.ActorAlign.START });
        hbox.add_actor(this._dayLabel);

        this._dateLabel = new St.Label({ style_class: 'date-label' });
        hbox.add_actor(this._dateLabel);

        this._calendar = calendar;
        this._calendar.connect('selected-date-changed', (calendar, date) => {
            // Make the button reactive only if the selected date is not the
            // current date.
            this.actor.reactive = !_isToday(date);
        });
    }

    setDate(date) {
        this._dayLabel.set_text(date.toLocaleFormat('%A'));

        /* Translators: This is the date format to use when the calendar popup is
         * shown - it is shown just below the time in the top bar (e.g.,
         * "Tue 9:29 AM").  The string itself should become a full date, e.g.,
         * "February 17 2015".
         */
        let dateFormat = Shell.util_translate_time_string (N_("%B %-d %Y"));
        this._dateLabel.set_text(date.toLocaleFormat(dateFormat));

        /* Translators: This is the accessible name of the date button shown
         * below the time in the shell; it should combine the weekday and the
         * date, e.g. "Tuesday February 17 2015".
         */
        dateFormat = Shell.util_translate_time_string (N_("%A %B %e %Y"));
        this.actor.accessible_name = date.toLocaleFormat(dateFormat);
    }
};

var MessagesIndicator = class MessagesIndicator {
    constructor() {
        this.actor = new St.Icon({ icon_name: 'message-indicator-symbolic',
                                   icon_size: 16,
                                   visible: false, y_expand: true,
                                   y_align: Clutter.ActorAlign.CENTER });

        this._sources = [];

        Main.messageTray.connect('source-added', this._onSourceAdded.bind(this));
        Main.messageTray.connect('source-removed', this._onSourceRemoved.bind(this));
        Main.messageTray.connect('queue-changed', this._updateCount.bind(this));

        let sources = Main.messageTray.getSources();
        sources.forEach(source => this._onSourceAdded(null, source));
    }

    _onSourceAdded(tray, source) {
        source.connect('count-updated', this._updateCount.bind(this));
        this._sources.push(source);
        this._updateCount();
    }

    _onSourceRemoved(tray, source) {
        this._sources.splice(this._sources.indexOf(source), 1);
        this._updateCount();
    }

    _updateCount() {
        let count = 0;
        this._sources.forEach(source => (count += source.unseenCount));
        count -= Main.messageTray.queueCount;

        this.actor.visible = (count > 0);
    }
};

var IndicatorPad = GObject.registerClass(
class IndicatorPad extends St.Widget {
    _init(actor) {
        this._source = actor;
        this._source.connect('notify::visible', () => this.queue_relayout());
        this._source.connect('notify::size', () => this.queue_relayout());
        super._init();
    }

    vfunc_get_preferred_width(forHeight) {
        if (this._source.visible)
            return this._source.get_preferred_width(forHeight);
        return [0, 0];
    }

    vfunc_get_preferred_height(forWidth) {
        if (this._source.visible)
            return this._source.get_preferred_height(forWidth);
        return [0, 0];
    }
});

var FreezableBinLayout = GObject.registerClass(
class FreezableBinLayout extends Clutter.BinLayout {
    _init() {
        super._init();

        this._frozen = false;
        this._savedWidth = [NaN, NaN];
        this._savedHeight = [NaN, NaN];
    }

    set frozen(v) {
        if (this._frozen == v)
            return;

        this._frozen = v;
        if (!this._frozen)
            this.layout_changed();
    }

    vfunc_get_preferred_width(container, forHeight) {
        if (!this._frozen || this._savedWidth.some(isNaN))
            return super.vfunc_get_preferred_width(container, forHeight);
        return this._savedWidth;
    }

    vfunc_get_preferred_height(container, forWidth) {
        if (!this._frozen || this._savedHeight.some(isNaN))
            return super.vfunc_get_preferred_height(container, forWidth);
        return this._savedHeight;
    }

    vfunc_allocate(container, allocation, flags) {
        super.vfunc_allocate(container, allocation, flags);

        let [width, height] = allocation.get_size();
        this._savedWidth = [width, width];
        this._savedHeight = [height, height];
    }
});

var CalendarColumnLayout = GObject.registerClass(
class CalendarColumnLayout extends Clutter.BoxLayout {
    _init(actor) {
        super._init({ orientation: Clutter.Orientation.VERTICAL });
        this._calActor = actor;
    }

    vfunc_get_preferred_width(container, forHeight) {
        if (!this._calActor || this._calActor.get_parent() != container)
            return super.vfunc_get_preferred_width(container, forHeight);
        return this._calActor.get_preferred_width(forHeight);
    }
});

var DateMenuButton = GObject.registerClass(
class DateMenuButton extends PanelMenu.Button {
    _init() {
        let hbox;
        let vbox;

        let menuAlignment = 0.5;
        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
            menuAlignment = 1.0 - menuAlignment;
        super._init(menuAlignment);

        this._clockDisplay = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
        this._indicator = new MessagesIndicator();

        let box = new St.BoxLayout();
        box.add_actor(new IndicatorPad(this._indicator.actor));
        box.add_actor(this._clockDisplay);
        box.add_actor(this._indicator.actor);

        this.label_actor = this._clockDisplay;
        this.add_actor(box);
        this.add_style_class_name ('clock-display');

        let layout = new FreezableBinLayout();
        let bin = new St.Widget({ layout_manager: layout });
        // For some minimal compatibility with PopupMenuItem
        bin._delegate = this;
        this.menu.box.add_child(bin);

        hbox = new St.BoxLayout({ name: 'calendarArea' });
        bin.add_actor(hbox);

        this._calendar = new Calendar.Calendar();
        this._calendar.connect('selected-date-changed',
                               (calendar, date) => {
                                   layout.frozen = !_isToday(date);
                                   this._messageList.setDate(date);
                               });

        this.menu.connect('open-state-changed', (menu, isOpen) => {
            // Whenever the menu is opened, select today
            if (isOpen) {
                let now = new Date();
                this._calendar.setDate(now);
                this._date.setDate(now);
                this._messageList.setDate(now);
            }
        });

        // Fill up the first column
        this._messageList = new Calendar.CalendarMessageList();
        hbox.add(this._messageList.actor, { expand: true, y_fill: false, y_align: St.Align.START });

        // Fill up the second column
        let boxLayout = new CalendarColumnLayout(this._calendar.actor);
        vbox = new St.Widget({ style_class: 'datemenu-calendar-column',
                               layout_manager: boxLayout });
        boxLayout.hookup_style(vbox);
        hbox.add(vbox);

        this._date = new TodayButton(this._calendar);
        vbox.add_actor(this._date.actor);

        vbox.add_actor(this._calendar.actor);

        // Done with hbox for calendar and event list

        this._clock = new GnomeDesktop.WallClock();
        this._clock.bind_property('clock', this._clockDisplay, 'text', GObject.BindingFlags.SYNC_CREATE);
        this._clock.connect('notify::timezone', this._updateTimeZone.bind(this));

        Main.sessionMode.connect('updated', this._sessionUpdated.bind(this));
        this._sessionUpdated();
    }

    _getEventSource() {
        return new Calendar.EmptyEventSource();
    }

    _setEventSource(eventSource) {
        if (this._eventSource)
            this._eventSource.destroy();

        this._calendar.setEventSource(eventSource);
        this._messageList.setEventSource(eventSource);

        this._eventSource = eventSource;
    }

    _updateTimeZone() {
        // SpiderMonkey caches the time zone so we must explicitly clear it
        // before we can update the calendar, see
        // https://bugzilla.gnome.org/show_bug.cgi?id=678507
        System.clearDateCaches();

        this._calendar.updateTimeZone();
    }

    _sessionUpdated() {
        let eventSource;
        let showEvents = Main.sessionMode.showCalendarEvents;
        if (showEvents) {
            eventSource = this._getEventSource();
        } else {
            eventSource = new Calendar.EmptyEventSource();
        }
        this._setEventSource(eventSource);
    }
});
