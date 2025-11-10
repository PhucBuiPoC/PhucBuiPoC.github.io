// Import from ServiceNow server - use absolute URLs
import "https://sccitsmsit.service-now.com/uxasset/externals/sn_embeddable_core/amb-proxy.jsdbx";
import "https://sccitsmsit.service-now.com/uxembeddables.do?sysparm_request_type=ux_globals";
import { sn_embeddables } from "https://sccitsmsit.service-now.com/uxasset/externals/sn-embeddables/index.jsdbx";

// Utility function
function interopPatch(interop) {
    return interop && interop.default ? Object.defineProperty(interop, "__esModule", { value: !0 }) : interop;
}

// Original fetch and XHR references
const originalFetch = window.fetch;
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;

// State management
let embeddables_state = {
    baseURL: '',
    isLoggedIn: false,
    macroponentTagNames: [],
    theme: '',
    hasAmbConnection: false,
    macroponentsLoaded: new Set(),
    enableSessionTimeoutHandler: true,
    authenticationHeader: false
};

let uiMega;
let componentInstances = {};

const SESSION_HEADER = {
    IS_LOGGED_IN: 'X-Is-Logged-In',
    SESSION_LOGGED_IN: 'X-Sessionloggedin'
};

// Proxy for state management
const embeddableStateProxy = new Proxy(embeddables_state, {
    set(target, property, value) {
        if (property === "authenticationHeader") {
            const oldValue = target[property];
            target[property] = value;
            trackAuthnHeaderChange(value, oldValue);
            return true;
        }
        target[property] = value;
        return true;
    }
});

function trackAuthnHeaderChange(newValue, oldValue) {
    if (oldValue === true && newValue === false) {
        handleSessionTimeOut();
    }
}

function handleInterceptors() {
    window.fetch = async function(...fetchArgs) {
        const response = await originalFetch(...fetchArgs);
        const respURL = new URL(response.url);
        if (respURL.origin == embeddables_state.baseURL)
            handleFetchResponse(response);
        return response;
    };

    function handleFetchResponse(response) {
        const isLoggedInHeader = response.headers.get(SESSION_HEADER.IS_LOGGED_IN);
        const isSessionLoggedInHeader = response.headers.get(SESSION_HEADER.SESSION_LOGGED_IN);
        setAuthnHeader(isLoggedInHeader, isSessionLoggedInHeader);
    }

    XMLHttpRequest.prototype.open = function(...args) {
        originalOpen.apply(this, args);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const xhr = this;
        const originalOnreadystatechange = xhr.onreadystatechange;

        xhr.onreadystatechange = function() {
            const respURL = new URL(xhr.responseURL);
            if (xhr.readyState === XMLHttpRequest.DONE && respURL.origin == embeddables_state.baseURL) {
                handleXhrResponse(xhr);
            }

            if (originalOnreadystatechange) {
                originalOnreadystatechange.apply(this, arguments);
            }
        };

        originalSend.call(xhr, body);
    };

    function handleXhrResponse(xhr) {
        const isLoggedInHeader = xhr.getResponseHeader(SESSION_HEADER.IS_LOGGED_IN);
        const isSessionLoggedInHeader = xhr.getResponseHeader(SESSION_HEADER.SESSION_LOGGED_IN);
        setAuthnHeader(isLoggedInHeader, isSessionLoggedInHeader);
    }
}

function disableInterceptors() {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
}

function setAuthnHeader(isLoggedInHeader, isSessionLoggedInHeader) {
    if ((isLoggedInHeader && isLoggedInHeader == 'false') || (isSessionLoggedInHeader && isSessionLoggedInHeader == 'false')) {
        embeddableStateProxy.authenticationHeader = false;
    } else if ((isLoggedInHeader && isLoggedInHeader == 'true') || (isSessionLoggedInHeader && isSessionLoggedInHeader == 'true')) {
        embeddableStateProxy.authenticationHeader = true;
    }
}

async function readComponentsFromPage() {
    uiMega = await import(embeddables_state.baseURL + '/uxasset/externals/@servicenow/ui-mega/index.jsdbx');
    componentInstances = uiMega.servicenowUiCore.getComponentInstances();
    if (Object.keys(componentInstances).length === 0) {
        return new Promise(resolve => setTimeout(resolve, 100)).then(readComponentsFromPage);
    }
}

async function findEmbeddableMacroponent() {
    const macroponentDoms = Object.values(componentInstances);
    let componentsFound = false;
    for (const macroponent of macroponentDoms) {
        if (embeddables_state.macroponentsLoaded.has(macroponent.tagName.toLowerCase())) {
            componentsFound = true;
            macroponent.dispatch('MACROPONENT_PAGE_ERROR_OCCURRED', {
                "errorType": "session_timeout"
            });
        }
    }
    return componentsFound;
}

async function handleSessionTimeOut() {
    await readComponentsFromPage();

    if (embeddables_state.macroponentsLoaded.size > 0) {
        var componentsFound = findEmbeddableMacroponent();
        if (!componentsFound)
            findEmbeddableMacroponent();
    }

    document.dispatchEvent(new CustomEvent('SN_EMBEDDABLES_SESSION_EXPIRED'));
}

var fetchTokenCallback = function() {
    return Promise.resolve();
};

function authenticate(token, retry = true) {
    if (embeddables_state.baseURL === '') {
        throw new Error("Base URL is not set");
    }

    const url = new URL("/api/now/client/authenticate", embeddables_state.baseURL);
    const options = {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token,
            "X-Interactive-Session": "true"
        },
        credentials: "include"
    };

    return fetch(url, options)
        .then(response => {
            if (response.ok) {
                embeddables_state.isLoggedIn = true;
            } else {
                return response.text().then(text => {
                    if (text) {
                        const body = JSON.parse(text);
                        if (retry && body.result === "Unexpected error occurred. Please try again.") {
                            return authenticate(token, false);
                        } else {
                            throw new Error("Error while authenticating: " + body.result);
                        }
                    } else {
                        throw new Error("Error while authenticating: " + response.statusText);
                    }
                });
            }
        })
        .catch(error => {
            throw new Error("Error while authenticating: " + error);
        });
}

async function updateLocale(locale) {
    var xhr = new XMLHttpRequest();
    xhr.open("PUT", new URL("/api/now/ui/concoursepicker/language", embeddables_state.baseURL), true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-UserToken", window.g_ck);
    await new Promise((resolve, reject) => {
        xhr.onreadystatechange = function() {
            if (xhr.readyState == 4) {
                if (xhr.status != 200) {
                    reject(new Error("Error while updating Language: " + xhr.statusText));
                } else {
                    resolve();
                }
            }
        };
        var payload = {
            current: locale,
        };
        payload = JSON.stringify(payload);
        xhr.send(payload);
    });
}

function generateSessionToken() {
    if (window.g_ck === undefined) {
        return new Promise((resolve, reject) => {
            var scriptTag = document.createElement("script");
            scriptTag.src = new URL("/uxembeddables.do?sysparm_request_type=ux_session", embeddables_state.baseURL);
            scriptTag.crossOrigin = "use-credentials";
            scriptTag.onload = function() {
                if (!embeddables_state.hasAmbConnection) {
                    embeddables_state.hasAmbConnection = true;
                    window.connectToAmb(embeddables_state.baseURL);
                }
                resolve();
            };
            document.head.appendChild(scriptTag);
        });
    }
}

// Exported functions
export async function init({
    authCallback,
    baseURL,
    locale,
    theme,
    interceptSessionTimeout = true,
    cacheComponents = []
}) {
    try {
        if (authCallback) {
            fetchTokenCallback = authCallback;
        }
        if (baseURL) {
            embeddables_state.baseURL = baseURL;
            nowUiFramework.setEmbeddableBaseUrl(baseURL);
            if (!embeddables_state.hasAmbConnection && window.location.origin.toLowerCase() === baseURL.toLowerCase()) {
                embeddables_state.hasAmbConnection = true;
                window.connectToAmb(embeddables_state.baseURL);
            }
        }
        if (theme) {
            await import(new URL('/uxembeddables.do?sysparm_request_type=ux_theme&themeId=' + theme, embeddables_state.baseURL));
            embeddables_state.theme = theme;
            sn_embeddables.loadTheme();
        }
        if (locale) {
            await updateLocale(locale);
        }

        embeddables_state.enableSessionTimeoutHandler = interceptSessionTimeout;
        if (interceptSessionTimeout)
            handleInterceptors();
        else
            disableInterceptors();

        if (cacheComponents.length > 0) {
            getEmbeddables(cacheComponents);
        }
    } catch (e) {
        console.error('Error in init:', e);
        throw e;
    }
}

export async function login() {
    try {
        const token = await fetchTokenCallback();
        if (token) {
            await authenticate(token);
            window.g_ck = undefined;
            await generateSessionToken();
            document.dispatchEvent(new CustomEvent('SN_EMBEDDABLES_LOGIN_SUCCESS'));
        } else {
            throw new Error("Token fetch failed");
        }
    } catch (error) {
        throw new Error("Error while logging in: " + error);
    }
}

export async function getEmbeddables(components) {
    try {
        await generateSessionToken();
        components.forEach((component) => embeddables_state.macroponentsLoaded.add(component.toLowerCase()));
        return sn_embeddables.initialize(components);
    } catch (e) {
        console.error('Error in getEmbeddables:', e);
        throw e;
    }
}

export async function logout() {
    try {
        if (embeddables_state.baseURL === '') {
            throw new Error("Base URL is not set");
        }
        const url = new URL("/logout.do", embeddables_state.baseURL);
        const options = {
            method: "GET",
            credentials: "include"
        };
        await fetch(url, options)
            .then(response => {
                if (response.ok) {
                    document.dispatchEvent(new CustomEvent('SN_EMBEDDABLES_LOGOUT_SUCCESS'));
                } else {
                    throw new Error("Logout failed with status: " + response.status);
                }
            })
            .catch(error => {
                throw new Error("Error during logout: " + error);
            });
    } catch (error) {
        throw new Error("Error during logout: " + error);
    }
}

export function loadComponent({
    tagName,
    properties = {},
    containerId,
    eventHandlers = {},
    batch = true
}) {
    return new Promise(async (resolve, reject) => {
        try {
            await generateSessionToken();
            if (tagName === undefined) {
                throw new Error("Tag name is not provided.");
            }
            const componentElm = document.createElement(tagName);
            setProperties(componentElm, properties);

            if (eventHandlers) {
                setEvents(componentElm, eventHandlers);
            }
            if (containerId) {
                var container = document.getElementById(containerId);
                if (container) {
                    container.appendChild(componentElm);
                } else {
                    throw new Error("Container element not found in the DOM.");
                }
            } else {
                throw new Error("Container ID is not provided.");
            }

            embeddables_state.macroponentsLoaded.add(tagName);

            if (batch) {
                embeddables_state.macroponentTagNames.push(tagName.toLowerCase());
                window.setTimeout(function() {
                    if (embeddables_state.macroponentTagNames.length > 0) {
                        sn_embeddables.initialize(embeddables_state.macroponentTagNames);
                        sn_embeddables.loadTheme();
                        embeddables_state.macroponentTagNames = [];
                        resolve();
                    }
                }, 10);
            } else {
                sn_embeddables.initialize([tagName]);
                sn_embeddables.loadTheme();
                resolve();
            }
        } catch (e) {
            console.error('Error in loadComponent:', e);
            reject(e);
        }
    });
}

export function setEvents(componentElm, eventHandlers) {
    for (const [key, value] of Object.entries(eventHandlers)) {
        componentElm.addEventListener(key, value);
    }
}

const kebabize = (str) => str.replace(/[A-Z]+(?![a-z])|[A-Z]/g, (s, of) => (of ? "-" : "") + s.toLowerCase());

export function setProperties(componentElm, properties = {}) {
    for (const prop in properties) {
        componentElm.removeAttribute(kebabize(prop));
        componentElm[prop] = properties[prop];
    }
}

// Create global API
try {
    window.SN_EMBEDDABLES = {
        init,
        login,
        logout,
        setEvents,
        setProperties,
        loadComponent,
        getEmbeddables
    };
    document.dispatchEvent(new CustomEvent('SN_EMBEDDABLES_READY'));
} catch (e) {
    console.error('Error setting up SN_EMBEDDABLES:', e);
}

// Export for module compatibility
export var __TECTONIC__sn_embeddable_core = window.__TECTONIC__sn_embeddable_core;
export { __TECTONIC__sn_embeddable_core as default };