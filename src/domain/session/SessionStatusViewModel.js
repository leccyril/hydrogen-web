import {ViewModel} from "../ViewModel.js";
import {createEnum} from "../../utils/enum.js";
import {ConnectionStatus} from "../../matrix/net/Reconnector.js";
import {SyncStatus} from "../../matrix/Sync.js";

const SessionStatus = createEnum(
    "Disconnected",
    "Connecting",
    "FirstSync",
    "Sending",
    "Syncing"
);

export class SessionStatusViewModel extends ViewModel {
    constructor(options) {
        super(options);
        const {syncStatus, reconnector} = options;
        this._syncStatus = syncStatus;
        this._reconnector = reconnector;
        this._status = this._calculateState(reconnector.connectionStatus.get(), syncStatus.get());
        
    }

    start() {
        const update = () => this._updateStatus();
        this.track(this._syncStatus.subscribe(update));
        this.track(this._reconnector.connectionStatus.subscribe(update));
    }

    get isShown() {
        return this._status !== SessionStatus.Syncing;
    }

    get statusLabel() {
        switch (this._status) {
            case SessionStatus.Disconnected:{
                const retryIn = Math.round(this._reconnector.retryIn / 1000);
                return this.i18n`Disconnected, trying to reconnect in ${retryIn}s…`;
            }
            case SessionStatus.Connecting:
                return this.i18n`Trying to reconnect now…`;
            case SessionStatus.FirstSync:
                return this.i18n`Catching up with your conversations…`;
        }
        return "";
    }

    get isWaiting() {
        switch (this._status) {
            case SessionStatus.Connecting:
            case SessionStatus.FirstSync:
                return true;
            default:
                return false;
        }
    }

    _updateStatus() {
        const newStatus = this._calculateState(
            this._reconnector.connectionStatus.get(),
            this._syncStatus.get()
        );
        if (newStatus !== this._status) {
            if (newStatus === SessionStatus.Disconnected) {
                this._retryTimer = this.track(this.clock.createInterval(() => {
                    this.emitChange("statusLabel");
                }, 1000));
            } else {
                this._retryTimer = this.disposeTracked(this._retryTimer);
            }
            this._status = newStatus;
            console.log("newStatus", newStatus);
            this.emitChange();
        }
    }

    _calculateState(connectionStatus, syncStatus) {
        if (connectionStatus !== ConnectionStatus.Online) {
            switch (connectionStatus) {
                case ConnectionStatus.Reconnecting:
                    return SessionStatus.Connecting;
                case ConnectionStatus.Waiting:
                    return SessionStatus.Disconnected;
            }
        } else if (syncStatus !== SyncStatus.Syncing) {
            switch (syncStatus) {
                // InitialSync should be awaited in the SessionLoadViewModel,
                // but include it here anyway
                case SyncStatus.InitialSync:
                case SyncStatus.CatchupSync:
                    return SessionStatus.FirstSync;
            }
        } /* else if (session.pendingMessageCount) {
            return SessionStatus.Sending;
        } */ else {
            return SessionStatus.Syncing;
        }
    }

    get isConnectNowShown() {
        return this._status === SessionStatus.Disconnected;
    }

    connectNow() {
        if (this.isConnectNowShown) {
            this._reconnector.tryNow();
        }
    }
}
