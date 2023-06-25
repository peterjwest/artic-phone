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

    const INITIAL_ACTIONS = [
        { type: 'tool', tool: 'pen' },
        { type: 'colour', value: '#000000' },
        { type: 'thickness', thickness: 2 },
    ];

    const EVENT_TYPES = ['mousedown', 'mouseup', 'mousemove', 'keydown', 'click', 'change', 'input'];
    const WRAPPED_EVENT_TYPES = new Set(EVENT_TYPES);

    const TOOLS = {
        pen: 'pen',
        ers: 'eraser',
        reb: 'rectangleOutline',
        ellb: 'ellipsisOutline',
        rec: 'rectangleFilled',
        ell: 'ellipsisFilled',
        lin: 'line',
        fil: 'fill',
        undo: 'undo',
        redo: 'redo',
    };
    const TOOLS_INVERTED = invertObject(TOOLS);
    const TOOLS_INDEXES = Object.fromEntries(Object.entries(TOOLS).map((([key, value], index) => [value, index])));
    const TOOLS_INDEXES_INVERTED = invertObject(TOOLS_INDEXES);

    const STROKE_DELAY = 90;
    const STROKE_BUFFER = 60;
    const TOOL_DELAY = 5;
    const SMOOTHING_THRESHOLD = 40 / 100;
    const CANVAS_OVERFLOW = 1;

    const MAX_VALUE = Math.pow(2, 16);

    window.actions = INITIAL_ACTIONS.slice();

    const listeners = new Map();
    let previousEvent;
    let canvas;
    let mouseIsDown = false;
    let isReplaying = false;

    function chunkArray(array, size) {
        const chunks = []
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    async function delay(amount) {
        await new Promise((resolve) => setTimeout(resolve, amount));
    }

    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    function base64ToArrayBuffer(base64) {
        const text = window.atob(base64);

        const buffer = new ArrayBuffer(text.length);
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < text.length; i++) {
            bytes[i] = text.charCodeAt(i);
        }
        return buffer;
    }

    function sum(array) {
        let total = 0;
        for (var value of array) total += value;
        return total;
    }

    function clampValue(value) {
        if (value > 1 + CANVAS_OVERFLOW) return 1 + CANVAS_OVERFLOW;
        if (value < -CANVAS_OVERFLOW) return -CANVAS_OVERFLOW;
        return value;
    }

    function mapToInt(value, maxValue) {
        return Math.floor((value + CANVAS_OVERFLOW) / (1 + CANVAS_OVERFLOW * 2) * maxValue);
    }

    function mapFromInt(value, maxValue) {
        return(value * (1 + CANVAS_OVERFLOW * 2) / maxValue) - CANVAS_OVERFLOW;
    }

    function encodeActions(actions) {
        const size = sum(actions.map((action) => {
            if (action.type === 'stroke') return 2 + action.events.length * 3;
            if (action.type === 'tool' || action.type === 'thickness') return 2;
            if (action.type === 'colour') return 4;
            if (action.type === 'undo' || action.type === 'redo') return 1;
        }));

        const arrayBuffer = new ArrayBuffer(size * 2);
        const encoded = new Uint16Array(arrayBuffer);

        let index = 0;
        for (const action of actions) {
            if (action.type === 'stroke') {
                encoded[index++] = 0;
                encoded[index++] = action.events.length;
                for (const event of action.events) {
                    encoded[index++] = EVENT_TYPES.indexOf(event.type);
                    encoded[index++] = mapToInt(event.x, MAX_VALUE);
                    encoded[index++] = mapToInt(event.y, MAX_VALUE);
                }
            }

            if (action.type === 'tool') {
                encoded[index++] = 1;
                encoded[index++] = TOOLS_INDEXES[action.tool];
            }

            if (action.type === 'thickness') {
                encoded[index++] = 2;
                encoded[index++] = action.thickness;
            }

            if (action.type === 'colour') {
                encoded[index++] = 3;
                const components = hexStringToRgb(action.value);
                encoded[index++] = components[0];
                encoded[index++] = components[1];
                encoded[index++] = components[2];
            }

            if (action.type === 'undo') {
                encoded[index++] = 4;
            }

            if (action.type === 'redo') {
                encoded[index++] = 5;
            }
        }

        return arrayBufferToBase64(arrayBuffer);
    }

    function decodeActions(string) {
        const arrayBuffer = base64ToArrayBuffer(string);
        const encoded = new Uint16Array(arrayBuffer);
        const actions = [];

        let index = 0;
        while (index < encoded.length) {
            const type = encoded[index++];

            if (type === 0) {
                const eventCount = encoded[index++];
                const events = [];
                for (let eventIndex = 0; eventIndex < eventCount; eventIndex++) {
                    events.push({
                        type: EVENT_TYPES[encoded[index++]],
                        x: mapFromInt(encoded[index++], MAX_VALUE),
                        y: mapFromInt(encoded[index++], MAX_VALUE),
                    });
                }
                actions.push({ type: 'stroke', events });
            }

            if (type === 1) {
                actions.push({ type: 'tool', tool: TOOLS_INDEXES_INVERTED[encoded[index++]] });
            }

            if (type === 2) {
                actions.push({ type: 'thickness', thickness: encoded[index++] });
            }

            if (type === 3) {
                actions.push({ type: 'colour', value: rgbToHexString([encoded[index++], encoded[index++], encoded[index++]]) });
            }

            if (type === 4) {
                actions.push({ type: 'undo' });
            }

            if (type === 5) {
                actions.push({ type: 'redo' });
            }
        }

        return actions;
    }

    function resolveUndos(baseActions) {
        const actions = baseActions.slice();

        let redoIndex;
        while (redoIndex = actions.findIndex((action) => action.type === 'redo'), redoIndex !== -1) {
            actions.splice(redoIndex, 1);

            let searchIndex = redoIndex - 1;
            while (searchIndex >= 0) {
                if (actions[searchIndex].type === 'stroke') break;
                if (actions[searchIndex].type === 'undo') {
                    actions.splice(searchIndex, 1);
                    break;
                }
                searchIndex--;
            }
        }

        let undoIndex;
        while (undoIndex = actions.findIndex((action) => action.type === 'undo'), undoIndex !== -1) {
            actions.splice(undoIndex, 1);

            let searchIndex = undoIndex - 1;
            while (searchIndex >= 0) {
                if (actions[searchIndex].type === 'stroke') {
                    actions.splice(searchIndex, 1);
                    break;
                }
                searchIndex--;
            }
        }

        return actions;
    }

    function resolveRedundant(baseActions) {
        const actions = baseActions.slice();

        for (const type in ['tool', 'colour', 'thickness']) {
            for (let index = 0; index < actions.length; index++) {
                if (actions[index].type === type) {
                    for (let searchIndex = index + 1; searchIndex < actions.length; searchIndex++) {
                        if (actions[searchIndex].type === 'stroke') break;
                        if (actions[searchIndex].type === type) {
                            // Decrement index so we don't skip the next item
                            actions.splice(index--, 1);
                            break;
                        }
                    }
                }
            }
        }

        return actions;
    }

    function cullEvents(actions) {
        return actions.map((action) => {
            if (action.type !== 'stroke') return action;
            return {
                ...action,
                events: action.events.filter((event, index) => {
                    if (index === 0 || index === action.events.length - 1) return true;
                    return index % 2 === 1;
                }),
            };
        });
    }

    // function cullEvents(actions) {
    //     let total = 0;
    //     let count = 0;
    //     const newActions = actions.map((action) => {
    //         if (action.type !== 'stroke') return action;
    //         let culled = false;
    //         return {
    //             ...action,
    //             events: action.events.filter((event, index) => {
    //                 total++;
    //                 const prevEvent = action.events[index - 1];
    //                 const nextEvent = action.events[index + 1];
    //                 if (!prevEvent || !nextEvent) return true;
    //                 if (culled) {
    //                     culled = false;
    //                     return true;
    //                 }
    //                 culled = getDistanceFromLine(prevEvent, event, nextEvent) < getDistance(prevEvent, nextEvent) * SMOOTHING_THRESHOLD;
    //                 if (culled) count++;
    //                 return !culled;
    //             }),
    //         };
    //     });
    //     console.log(count / total);
    //     return newActions;
    // }

    function countPreviousSiblings(element) {
        let count = 0;
        while (element = element.previousSibling) {
            if (element.nodeType === 3) continue;
            count++
        }
        return count;
    }

    function integerToHexString(value) {
        return value.toString(16).padStart(2, '0');
    }

    function rgbToHexString(components) {
        return '#' + components.map(integerToHexString).join('').toUpperCase();
    }

    function hexStringToRgb(hex) {
        return hex.match(/^#([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})/i).slice(1).map((value) => parseInt(value, 16));
    }

    function roundToNearestAlpha(components) {
        if (components.find((value) => value % 16 > 9 || value > 0x99)) return components;
        const index = components.map((value, index) => [Math.abs((value % 16) - 4.5), index]).sort((a, b) => b[0] - a[0])[0][1];

        const change = components[index] % 16 >= 5 || components[index] < 0x10 ? 10 - components[index] % 16 : -1 - (components[index] % 16)
        return components.map((value) => value + change)
    }

    // Sends a fake click event which is not recorded by our hooks
    function fakeClick(element) {
        element.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            ctrlKey: true
        }));
    }

    function fakeColourChange(element, value) {
        element.value = value;
        element.setAttribute('value', value);
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Inverts the keys and values of an object
    function invertObject(object) {
        return Object.fromEntries(Object.entries(object).map(([key, value]) => [value, key]));
    }

    // Get the last or nth last element
    function getLastElement(array, nth) {
        nth = nth || 1;
        return array[array.length - nth];
    }

    function isDuplicate(eventA, eventB) {
        if (!eventA || !eventB) return false;
        return eventA.type === eventB.type && eventA.clientX === eventB.clientX && eventA.clientY === eventB.clientY;
    }

    function withinBounds(event, bounds) {
        return event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    }

    function getDistanceFromLine(a, b, c) {
        return Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / Math.sqrt(Math.pow(c.x - a.x, 2) + Math.pow(c.y - a.y, 2));
    }

    function getDistance(a, b) {
        return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
    }

    function recordEvent(event) {
        // Refetch canvas on mouse down
        if (event.type === 'mousedown') canvas = document.querySelector('.drawingContainer canvas');
        if (!canvas) return;

        if (event.type === 'keydown') {
            if (event.key === 'z' && event.metaKey && !mouseIsDown) {
                window.actions.push({ type: event.shiftKey ? 'redo' : 'undo' });
            }

            return;
        }

        if (event.type === 'click') {
            if (event.target.classList.contains('tool') && !event.target.classList.contains('sel')) {
                if (event.target.classList.contains('undo')) {
                    window.actions.push({ type: 'undo' });
                    return;
                }

                if (event.target.classList.contains('redo')) {
                    window.actions.push({ type: 'redo' });
                    return;
                }

                window.actions.push({ type: 'tool', tool: TOOLS[getLastElement(event.target.classList)] });
                return;
            }

            if (event.target.classList.contains('thickness') && !event.target.classList.contains('sel')) {
                window.actions.push({ type: 'thickness', thickness: countPreviousSiblings(event.target) + 1 });
            }

            if (event.target.classList.contains('color') && event.target.parentElement.classList.contains('colorslist')) {
                const components = event.target.style['background-color'].match(/rgb\((\d+), (\d+), (\d+)\)/).slice(1).map((value) => parseInt(value, 10));
                window.actions.push({ type: 'colour', value: rgbToHexString(roundToNearestAlpha(components)) });
            }

            return;
        }

        if (event.type === 'change') {
            if (event.target.type === 'color') {
                const hexColour = rgbToHexString(roundToNearestAlpha(hexStringToRgb(event.target.value.toUpperCase())));
                const colour = { type: 'colour', value: hexColour };

                // If the mouse is down, then a mousedown event has fired before the change event,
                // in which case this should be the previous colour
                if (mouseIsDown) window.actions.splice(-1, 0, colour);
                else window.actions.push(colour);
            }
            return;
        }

        const bounds = canvas.getBoundingClientRect();

        // Ignore duplicate events
        if (isDuplicate(previousEvent, event)) return;

        // Ignore invalid mousedown events
        if (event.type === 'mousedown' && event.target.tagName !== 'CANVAS') return;
        // if (event.type === 'mousedown' && !withinBounds(event, bounds)) return;

        // Ignore invalid mousemove events
        if ((event.type === 'mousemove' || event.type === 'mouseup') && !mouseIsDown) return;

        // Record if mouse is down or up
        if (event.type === 'mousedown') mouseIsDown = true;
        if (event.type === 'mouseup') mouseIsDown = false;

        let currentAction = getLastElement(window.actions);

        // Mouse down events start a new stroke
        if (event.type === 'mousedown') {
            currentAction = { type: 'stroke', events: [] };
            window.actions.push(currentAction);
        }

        // Ignore non-stroke actions
        if (currentAction.type !== 'stroke') return;

        const eventData = {
            type: event.type,
            x: clampValue((event.clientX - bounds.left) / (bounds.right - bounds.left)),
            y: clampValue((event.clientY - bounds.top) / (bounds.bottom - bounds.top)),
        }

        // // Smoothing for mouse move events
        // if (event.type === 'mousemove' && currentAction && currentAction.events.length >= 2) {
        //     const lastEvent = getLastElement(currentAction.events);
        //     const lastLastEvent = getLastElement(currentAction.events, 2);
        //     if (getDistanceFromLine(lastLastEvent, lastEvent, eventData) < getDistance(lastLastEvent, eventData) * SMOOTHING_THRESHOLD) {
        //         currentAction.events.pop();
        //     }
        // }

        if (currentAction) {
            currentAction.events.push(eventData);
        }
    }

    const baseAddEventListener = Element.prototype.addEventListener
    Element.prototype.addEventListener = function(type, listener, options) {
        if (!WRAPPED_EVENT_TYPES.has(type)) {
            return baseAddEventListener.call(this, type, listener, options);
        }

        const wrapperListener = function(event) {
            // Fake events are marked with a ctrl key, we wrap these to fool consumers,
            // except the colour input, which cannot have that property
            if (event.ctrlKey || (event.type === 'input' && event.target.type === 'color')) {

                const newEvent = {};
                for (const property in event) {
                    newEvent[property] = typeof event[property] === 'function' ? (...args) => event[property](...args) : event[property];
                }
                newEvent.isTrusted = true;

                Object.setPrototypeOf(newEvent, Object.getPrototypeOf(event));
                return listener(newEvent);
            }

            recordEvent(event);

            previousEvent = event;

            // Ban confusing undo behaviour while drawing
            if (mouseIsDown && event.type === 'keydown' && event.key === 'z' && event.metaKey) {
                return;
            }

            // Ban real mouse events when replaying
            if (isReplaying && (event.type === 'mouseup' || event.type === 'mousedown' || event.type === 'mousemove')) {
                return;
            }

            return listener(event);
        }
        if (!listeners.has(this)) listeners.set(this, new Map());
        if (!listeners.get(this).has(type)) listeners.get(this).set(type, new Map());
        listeners.get(this).get(type).set(listener, wrapperListener);
        baseAddEventListener.call(this, type, wrapperListener, options);
    }

    const baseRemoveEventListener = Element.prototype.removeEventListener;
    Element.prototype.removeEventListener = function(type, listener, options) {
        if (!WRAPPED_EVENT_TYPES.has(type)) {
            return baseRemoveEventListener.call(this, type, listener, options);
        }

        const wrapperListener = listeners.get(this).get(type).get(listener);
        listeners.get(this).get(type).delete(listener);
        baseRemoveEventListener.call(this, type, wrapperListener, options);
    }

    document.addEventListener = Element.prototype.addEventListener;
    document.removeEventListener = Element.prototype.removeEventListener;

    const controls = document.createElement('div');
    controls.style.position = 'absolute';
    controls.style.top = '10px';
    controls.style.right = '10px';
    controls.style['z-index'] = '999999';
    document.body.appendChild(controls);

    const name = document.createElement('input');
    name.type = 'text';
    controls.appendChild(name);

    const load = document.createElement('button');
    load.innerText = 'Load';
    controls.appendChild(load);

    load.addEventListener('click', async () => {
        window.actions = decodeActions(localStorage.getItem('artic-phone-' + name.value.trim()));
    });

    const draw = document.createElement('button');
    draw.innerText = 'Draw';
    controls.appendChild(draw);

    draw.addEventListener('click', async () => {
        canvas = document.querySelector('.drawingContainer canvas');
        if (!canvas) throw new Error('Canvas not ready!');

        const initialActions = window.actions.slice();
        const actions = cullEvents(resolveRedundant(resolveUndos(initialActions)));

        const bounds = canvas.getBoundingClientRect();

        let count = 0;
        let index = 0;

        isReplaying = true;

        for (const action of actions) {
            step.value = index++;
            if (action.type === 'stroke') {
                for (const event of action.events) {
                    canvas.dispatchEvent(new MouseEvent(event.type, {
                        bubbles: true,
                        clientX: event.x * (bounds.right - bounds.left) + bounds.left,
                        clientY: event.y * (bounds.bottom - bounds.top) + bounds.top,
                        ctrlKey: true
                    }))
                    if (count++ >= 10) {
                        await delay(STROKE_BUFFER);
                        count = 0;
                    }
                }
                await delay(STROKE_DELAY);
            }

            if (action.type === 'tool') {
                const tool = document.querySelector(`.tool.${TOOLS_INVERTED[action.tool]}`);
                fakeClick(tool);
                await delay(TOOL_DELAY);
            }

            if (action.type === 'thickness') {
                const tool = document.querySelectorAll(`.thickness`)[action.thickness - 1];
                fakeClick(tool);
                await delay(TOOL_DELAY);
            }

            if (action.type === 'colour') {
                const input = document.querySelector(`.colors input[type=color]`);
                fakeColourChange(input, action.value);
                await delay(5);
            }

            if (action.type === 'undo') {
                const undo = document.querySelector('.tool.undo');
                fakeClick(undo);
                await delay(TOOL_DELAY);
            }

            if (action.type === 'redo') {
                const redo = document.querySelector('.tool.redo');
                fakeClick(redo);
                await delay(TOOL_DELAY);
            }
        }

        isReplaying = false;

        // Restore actions so that no new actions are recorded when drawing
        window.actions = initialActions;
    });

    const save = document.createElement('button');
    save.innerText = 'Save';
    controls.appendChild(save);

    save.addEventListener('click', async () => {
        localStorage.setItem('artic-phone-' + name.value.trim(), encodeActions(window.actions));
    });

    const clear = document.createElement('button');
    clear.innerText = 'Clear';
    controls.appendChild(clear);

    clear.addEventListener('click', async () => {
        fakeClick(document.querySelector(`.tool.pen`));
        fakeClick(document.querySelector(`.colorslist .color`));
        fakeClick(document.querySelectorAll(`.thickness`)[1]);
        window.actions = INITIAL_ACTIONS.slice();
    });

    const step = document.createElement('input');
    step.value = 0;
    step.type = 'text';
    step.disabled = true;
    step.style.width = '50px';
    controls.appendChild(step);
})();
