// ==UserScript==
// @name         No events
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://garticphone.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tampermonkey.net
// @grant        none
// @run-at:      document-start
// ==/UserScript==

(function() {
    'use strict';

    const listeners = new Map();

    const baseAddEventListener = Element.prototype.addEventListener
    Element.prototype.addEventListener = function(type, listener, options) {
        console.log('LISTENER', type)
        if (type === 'pointerover' || type === 'pointermove' || type === 'mouseover') return

        const wrapperListener = function(event) {
            if (!event.ctrlKey) {
                if (event.target.tagName === 'CANVAS') console.log('REAL EVENT', event.type, event)
                return listener(event)
            }

            const newEvent = {}
            for (const property in event) {
                newEvent[property] = typeof event[property] === 'function' ? (...args) => event[property](...args) : event[property]
            }
            newEvent.isTrusted = true
            console.log('FAKE EVENT', newEvent.type, newEvent)

            Object.setPrototypeOf(newEvent, Object.getPrototypeOf(event))
            return listener(newEvent)
        }
        if (!listeners.has(this)) listeners.set(this, new Map())
        if (!listeners.get(this).has(type)) listeners.get(this).set(type, new Map())
        listeners.get(this).get(type).set(listener, wrapperListener)
        baseAddEventListener.call(this, type, wrapperListener, options)
    }

    const baseRemoveEventListener = Element.prototype.removeEventListener
    Element.prototype.removeEventListener = function(type, listener, options) {
        if (type === 'pointerover' || type === 'pointermove') return

        const wrapperListener = listeners.get(this).get(type).get(listener)
        if (wrapperListener) console.log('REMOVE LISTENER', type)
        listeners.get(this).get(type).delete(listener)
        baseRemoveEventListener.call(this, type, wrapperListener, options)
    }

    document.addEventListener = Element.prototype.addEventListener
    document.removeEventListener = Element.prototype.removeEventListener
})();