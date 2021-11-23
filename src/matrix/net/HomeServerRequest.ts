/*
Copyright 2020 Bruno Windels <bruno@windels.cloud>
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import {HomeServerError, ConnectionError} from "../error.js";
import type {RequestResult} from "../../platform/web/dom/request/fetch.js";
import type {LogItem} from "../../logging/LogItem";

export class HomeServerRequest {
    // todo: Shouldn't log be of type ILogItem; but ILogItem does not have finish method
    private readonly _log?: LogItem;
    private _sourceRequest?: RequestResult;
    private readonly _promise: Promise<any>;

    constructor(method: string, url: string, sourceRequest: RequestResult, log?: LogItem) {
        this._log = log;
        this._sourceRequest = sourceRequest;
        this._promise = sourceRequest.response().then(response => {
            log?.set("status", response.status);
            // ok?
            if (response.status >= 200 && response.status < 300) {
                log?.finish();
                return response.body;
            } else {
                if (response.status >= 500) {
                    const err = new ConnectionError(`Internal Server Error`);
                    log?.catch(err);
                    throw err;
                } else if (response.status >= 400 && !response.body?.errcode) {
                    const err = new ConnectionError(`HTTP error status ${response.status} without errcode in body, assume this is a load balancer complaining the server is offline.`);
                    log?.catch(err);
                    throw err;
                } else {
                    const err = new HomeServerError(method, url, response.body, response.status);
                    log?.set("errcode", err.errcode);
                    log?.catch(err);
                    throw err;
                }
            }
        }, err => {
            // if this._sourceRequest is still set,
            // the abort error came not from calling abort here
            if (err.name === "AbortError" && this._sourceRequest) {
                // The service worker sometimes (only on Firefox, on long, large request,
                // perhaps it has its own timeout?) aborts the request, see #187.
                // When it happens, the best thing to do seems to be to retry.
                // 
                // In the service worker, we will also actively abort all
                // ongoing requests when trying to get a new service worker to activate
                // (this may surface in the app as a TypeError, which already gets mapped
                // to a ConnectionError in the request function, or an AbortError,
                // depending on the browser), as the service worker will only be
                // replaced when there are no more (fetch) events for the
                // current one to handle.
                // 
                // In that case, the request function (in fetch.js) will check 
                // the haltRequests flag on the service worker handler, and
                // block any new requests, as that would break the update process.
                // 
                // So it is OK to return a ConnectionError here.
                // If we're updating the service worker, the /versions polling will
                // be blocked at the fetch level because haltRequests is set.
                // And for #187, retrying is the right thing to do.
                const err = new ConnectionError(`Service worker aborted, either updating or hit #187.`);
                log?.catch(err);
                throw err;
            } else {
                if (err.name === "ConnectionError") {
                    log?.set("timeout", err.isTimeout);
                }
                log?.catch(err);
                throw err;
            }
        });
    }

    abort(): void {
        if (this._sourceRequest) {
            this._log?.set("aborted", true);
            this._sourceRequest.abort();
            // to mark that it was on purpose in above rejection handler
            this._sourceRequest = undefined;
        }
    }

    response(): Promise<any> {
        return this._promise;
    }
}

import {Request as MockRequest} from "../../mocks/Request.js";
import {AbortError} from "../error.js";

export function tests() {
    return {
        "Response is passed through": async assert => {
            const request = new MockRequest();
            const hsRequest = new HomeServerRequest("GET", "https://hs.tld/foo", request);
            request.respond(200, "foo");
            assert.equal(await hsRequest.response(), "foo");
        },
        "Unexpected AbortError is mapped to ConnectionError": async assert => {
            const request = new MockRequest();
            const hsRequest = new HomeServerRequest("GET", "https://hs.tld/foo", request);
            request.reject(new AbortError());
            await assert.rejects(hsRequest.response(), ConnectionError);
        },
        "500 response is mapped to ConnectionError": async assert => {
            const request = new MockRequest();
            const hsRequest = new HomeServerRequest("GET", "https://hs.tld/foo", request);
            request.respond(500);
            await assert.rejects(hsRequest.response(), ConnectionError);
        },
        "4xx response is mapped to HomeServerError": async assert => {
            const request = new MockRequest();
            const hsRequest = new HomeServerRequest("GET", "https://hs.tld/foo", request);
            request.respond(400, {errcode: "FOO"});
            await assert.rejects(hsRequest.response(), HomeServerError);
        },
        "4xx response without errcode is mapped to ConnectionError": async assert => {
            const request = new MockRequest();
            const hsRequest = new HomeServerRequest("GET", "https://hs.tld/foo", request);
            request.respond(400);
            await assert.rejects(hsRequest.response(), ConnectionError);
        },
        "Other errors are passed through": async assert => {
            class MyError extends Error {}
            const request = new MockRequest();
            const hsRequest = new HomeServerRequest("GET", "https://hs.tld/foo", request);
            request.reject(new MyError());
            await assert.rejects(hsRequest.response(), MyError);
        },
    };
}
