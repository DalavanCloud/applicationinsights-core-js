import { IAppInsightsCore } from "../JavaScriptSDK.Interfaces/IAppInsightsCore"
import { IConfiguration } from "../JavaScriptSDK.Interfaces/IConfiguration";
import { ITelemetryPlugin, IPlugin } from "../JavaScriptSDK.Interfaces/ITelemetryPlugin";
import { IChannelControls, MinChannelPriorty } from "../JavaScriptSDK.Interfaces/IChannelControls";
import { ITelemetryItem } from "../JavaScriptSDK.Interfaces/ITelemetryItem";
import { INotificationListener } from "../JavaScriptSDK.Interfaces/INotificationListener";
import { EventsDiscardedReason } from "../JavaScriptSDK.Enums/EventsDiscardedReason";
import { CoreUtils } from "./CoreUtils";
import { NotificationManager } from "./NotificationManager";

"use strict";

export class AppInsightsCore implements IAppInsightsCore {

    public config: IConfiguration;
    public static defaultConfig: IConfiguration;

    private _extensions: Array<IPlugin>;
    private _notificationManager: NotificationManager;

    constructor() {
        this._extensions = new Array<IPlugin>();
    }

    initialize(config: IConfiguration, extensions: IPlugin[]): void {

        if (!extensions || extensions.length === 0) {
            // throw error
            throw Error("At least one extension channel is required");
        }

        if (!config || CoreUtils.isNullOrUndefined(config.instrumentationKey)) {
            throw Error("Please provide instrumentation key");
        }

        this.config = config;

        // add notification to the extensions in the config so other plugins can access it
        this._notificationManager = new NotificationManager();
        this.config.extensions = this.config.extensions ? this.config.extensions : {};
        this.config.extensions.NotificationManager = this._notificationManager;

        // Initial validation
        extensions.forEach((extension: ITelemetryPlugin) => {
            if (CoreUtils.isNullOrUndefined(extension.initialize)) {
                throw Error("Extensions must provide callback to initialize");
            }
        });

        this._extensions = extensions.sort((a, b) => {
            let extA = (<ITelemetryPlugin>a);
            let extB = (<ITelemetryPlugin>b);
            let typeExtA = typeof extA.processTelemetry;
            let typeExtB = typeof extB.processTelemetry;
            if (typeExtA === 'function' && typeExtB === 'function') {
                return extA.priority > extB.priority ? 1 : -1;
            }

            if (typeExtA === 'function' && typeExtB !== 'function') {
                // keep non telemetryplugin specific extensions at start
                return 1;
            }

            if (typeExtA !== 'function' && typeExtB === 'function') {
                return -1;
            }
        });

        // Set next plugin for all but last extension
        for (let idx = 0; idx < this._extensions.length - 1; idx++) {
            if (this._extensions[idx] && typeof (<any>this._extensions[idx]).processTelemetry !== 'function') {
                // these are initialized only
                continue;
            }

            (<any>this._extensions[idx]).setNextPlugin(this._extensions[idx + 1]); // set next plugin
        }

        this._extensions.forEach(ext => ext.initialize(this.config, this, this._extensions)); // initialize
    }


    getTransmissionControl(): IChannelControls {
        for (let i = 0; i < this._extensions.length; i++) {
            let priority = (<any>this._extensions[i]).priority;
            if (!CoreUtils.isNullOrUndefined(priority) && priority >= MinChannelPriorty) {
                let firstChannel = <any>this._extensions[i];
                return firstChannel as IChannelControls; // return first channel in list
            }
        }

        throw new Error("No channel extension found");
    }

    track(telemetryItem: ITelemetryItem) {
        if (telemetryItem === null) {
            this._notifiyInvalidEvent(telemetryItem);
            // throw error
            throw Error("Invalid telemetry item");
        }

        if (telemetryItem.baseData && !telemetryItem.baseType) {
            this._notifiyInvalidEvent(telemetryItem);
            throw Error("Provide data.baseType for data.baseData");
        }

        // do base validation before sending it through the pipeline        
        this._validateTelmetryItem(telemetryItem);
        if (!telemetryItem.instrumentationKey) {
            // setup default ikey if not passed in
            telemetryItem.instrumentationKey = this.config.instrumentationKey;
        }

        // invoke any common telemetry processors before sending through pipeline

        let i = 0;
        while (i < this._extensions.length) {
            if ((<any>this._extensions[i]).processTelemetry) {
                (<any>this._extensions[i]).processTelemetry(telemetryItem); // pass on to first extension that can support processing
                break;
            }

            i++;
        }
    }

    /**
     * Adds a notification listener. The SDK calls methods on the listener when an appropriate notification is raised.
     * The added plugins must raise notifications. If the plugins do not implement the notifications, then no methods will be
     * called.
     * @param {INotificationListener} listener - An INotificationListener object.
     */
    addNotificationListener(listener: INotificationListener): void {
        this._notificationManager.addNotificationListener(listener);
    }

    /**
     * Removes all instances of the listener.
     * @param {INotificationListener} listener - INotificationListener to remove.
     */
    removeNotificationListener(listener: INotificationListener): void {
        this._notificationManager.removeNotificationListener(listener);
    }

    private _validateTelmetryItem(telemetryItem: ITelemetryItem) {

        if (CoreUtils.isNullOrUndefined(telemetryItem.name)) {
            this._notifiyInvalidEvent(telemetryItem);
            throw Error("telemetry name required");
        }

        if (CoreUtils.isNullOrUndefined(telemetryItem.timestamp)) {
            this._notifiyInvalidEvent(telemetryItem);
            throw Error("telemetry timestamp required");
        }

        if (CoreUtils.isNullOrUndefined(telemetryItem.instrumentationKey)) {
            this._notifiyInvalidEvent(telemetryItem);
            throw Error("telemetry instrumentationKey required");
        }
    }

    private _notifiyInvalidEvent(telemetryItem: ITelemetryItem): void {
        this._notificationManager.eventsDiscarded([telemetryItem], EventsDiscardedReason.InvalidEvent);
    }
}