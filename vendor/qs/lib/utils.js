'use strict';

var formats = require('./formats');
var getSideChannel = require('side-channel');
var defineProperty = require('es-define-property');

var has = Object.prototype.hasOwnProperty;
var isArray = Array.isArray;

// Track objects created from arrayLimit overflow using side-channel
// Stores the current max numeric index for O(1) lookup
var overflowChannel = getSideChannel();

var markOverflow = function markOverflow(obj, maxIndex) {
    overflowChannel.set(obj, maxIndex);
    return obj;
};

var isOverflow = function isOverflow(obj) {
    return overflowChannel.has(obj);
};

var getMaxIndex = function getMaxIndex(obj) {
    return overflowChannel.get(obj);
};

var setMaxIndex = function setMaxIndex(obj, maxIndex) {
    overflowChannel.set(obj, maxIndex);
};

// Track containers produced by a `strictMerge` conflict wrap, and their current max numeric index,
// so repeated conflicts on one path append instead of nesting a new wrapper each time
var conflictChannel = getSideChannel();

var markConflict = function markConflict(obj, maxIndex) {
    conflictChannel.set(obj, maxIndex);
    return obj;
};

var isConflict = function isConflict(obj) {
    return conflictChannel.has(obj);
};

var getConflictIndex = function getConflictIndex(obj) {
    return conflictChannel.get(obj);
};

var hexTable = (function () {
    var array = [];
    for (var i = 0; i < 256; ++i) {
        array[array.length] = '%' + ((i < 16 ? '0' : '') + i.toString(16)).toUpperCase();
    }

    return array;
}());

var compactQueue = function compactQueue(queue) {
    while (queue.length > 1) {
        var item = queue.pop();
        var obj = item.obj[item.prop];

        if (isArray(obj)) {
            var compacted = [];

            for (var j = 0; j < obj.length; ++j) {
                if (typeof obj[j] !== 'undefined') {
                    compacted[compacted.length] = obj[j];
                }
            }

            item.obj[item.prop] = compacted;
        }
    }
};

var arrayToObject = function arrayToObject(source, options) {
    var obj = options && options.plainObjects ? { __proto__: null } : {};
    for (var i = 0; i < source.length; ++i) {
        if (typeof source[i] !== 'undefined') {
            obj[i] = source[i];
        }
    }

    return obj;
};

var setProperty = function setProperty(obj, key, value) {
    if (key === '__proto__' && defineProperty) {
        defineProperty(obj, key, {
            configurable: true,
            enumerable: true,
            value: value,
            writable: true
        });
    } else {
        obj[key] = value;
    }
};

var isLargerIndex = function isLargerIndex(key, current) {
    var previous = String(current);
    return /^(0|[1-9][0-9]*)$/.test(key) && (
        previous === '-1'
        || key.length > previous.length
        || (key.length === previous.length && key > previous)
    );
};

var incrementIndex = function incrementIndex(index) {
    if (typeof index === 'number' && index < 0x1FFFFFFFFFFFFF) {
        return index + 1;
    }
    var digits = String(index).split('');
    for (var position = digits.length - 1; position >= 0; position -= 1) {
        if (digits[position] !== '9') {
            digits[position] = String(Number(digits[position]) + 1);
            return digits.join('');
        }
        digits[position] = '0';
    }
    digits.unshift('1');
    return digits.join('');
};

var maxNumericIndex = function maxNumericIndex(obj, min) {
    var max = min;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; ++i) {
        if (isLargerIndex(keys[i], max)) {
            max = keys[i];
        }
    }

    return max;
};

var countElements = function countElements(arr) {
    var count = 0;
    for (var index = 0; index < arr.length; ++index) {
        if (has.call(arr, index)) {
            count += 1;
        }
    }
    return count;
};

var limitedPair = function limitedPair(first, second, options) {
    var pair = [first, second];
    if (options && typeof options.arrayLimit === 'number' && pair.length > options.arrayLimit) {
        if (options.throwOnLimitExceeded) {
            throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
        }
        return markOverflow(arrayToObject(pair, options), 1);
    }
    return pair;
};

var merge = function merge(target, source, options) {
    /* eslint no-param-reassign: 0 */
    if (!source) {
        return target;
    }

    if (typeof source !== 'object' && typeof source !== 'function') {
        if (isArray(target)) {
            var nextIndex = target.length;
            if (options && typeof options.arrayLimit === 'number' && countElements(target) >= options.arrayLimit) {
                if (options.throwOnLimitExceeded) {
                    throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
                }
                return markOverflow(arrayToObject(target.concat(source), options), nextIndex);
            }
            target[nextIndex] = source;
        } else if (target && typeof target === 'object') {
            if (isOverflow(target)) {
                // Add at next numeric index for overflow objects
                var newIndex = incrementIndex(getMaxIndex(target));
                setProperty(target, newIndex, source);
                setMaxIndex(target, newIndex);
            } else if (options && options.strictMerge && isConflict(target)) {
                var nextConflict = incrementIndex(getConflictIndex(target));
                if (
                    options.throwOnLimitExceeded
                    && typeof options.arrayLimit === 'number'
                    && options.arrayLimit !== Infinity
                    && nextConflict >= options.arrayLimit
                ) {
                    throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
                }
                setProperty(target, nextConflict, source);
                markConflict(target, nextConflict);
            } else if (options && options.strictMerge) {
                var conflict = limitedPair(target, source, options);
                return isArray(conflict) ? markConflict(conflict, 1) : conflict;
            } else if (
                (options && (options.plainObjects || options.allowPrototypes))
                || !has.call(Object.prototype, source)
            ) {
                target[source] = true;
            }
        } else {
            return limitedPair(target, source, options);
        }

        return target;
    }

    if (!target || typeof target !== 'object') {
        if (isOverflow(source)) {
            // Create new object with target at 0, source values shifted by 1
            var sourceKeys = Object.keys(source);
            var result = options && options.plainObjects
                ? { __proto__: null, 0: target }
                : { 0: target };
            for (var m = 0; m < sourceKeys.length; m++) {
                var oldKey = sourceKeys[m];
                var shiftedKey = isLargerIndex(oldKey, -1) ? incrementIndex(oldKey) : oldKey;
                setProperty(result, shiftedKey, source[oldKey]);
            }
            return markOverflow(result, maxNumericIndex(result, 0));
        }
        var combined = [target].concat(source);
        if (options && typeof options.arrayLimit === 'number' && combined.length > options.arrayLimit) {
            if (options.throwOnLimitExceeded) {
                throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
            }
            return markOverflow(arrayToObject(combined, options), combined.length - 1);
        }
        return combined;
    }

    var mergeTarget = target;
    if (isArray(target) && !isArray(source)) {
        mergeTarget = arrayToObject(target, options);
        if (isConflict(target)) {
            // the array may have grown past its last conflict, so continue after its last index
            markConflict(mergeTarget, target.length - 1);
        }
    }

    if (isArray(target) && isArray(source)) {
        source.forEach(function (item, i) {
            if (has.call(target, i)) {
                var targetItem = target[i];
                if (targetItem && typeof targetItem === 'object' && item && typeof item === 'object') {
                    target[i] = merge(targetItem, item, options);
                } else {
                    target[target.length] = item;
                }
            } else {
                target[i] = item;
            }
        });
        if (options && typeof options.arrayLimit === 'number' && countElements(target) > options.arrayLimit) {
            if (options.throwOnLimitExceeded) {
                throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
            }
            return markOverflow(arrayToObject(target, options), target.length - 1);
        }
        return target;
    }

    return Object.keys(source).reduce(function (acc, key) {
        var value = source[key];

        if (has.call(acc, key)) {
            setProperty(acc, key, merge(acc[key], value, options));
        } else {
            setProperty(acc, key, value);
        }

        if (isOverflow(source) && !isOverflow(acc)) {
            markOverflow(acc, maxNumericIndex(acc, getMaxIndex(source)));
        }
        if (isOverflow(acc)) {
            if (isLargerIndex(key, getMaxIndex(acc))) {
                setMaxIndex(acc, key);
            }
        }
        if (isConflict(acc)) {
            if (isLargerIndex(key, getConflictIndex(acc))) {
                markConflict(acc, key);
            }
        }

        return acc;
    }, mergeTarget);
};

var assign = function assignSingleSource(target, source) {
    return Object.keys(source).reduce(function (acc, key) {
        setProperty(acc, key, source[key]);
        return acc;
    }, target);
};

var decode = function (str, defaultDecoder, charset) {
    // With no `%` there is no escape to expand, in either charset: `unescape` has
    // nothing to match, and `decodeURIComponent` is the identity on such a string
    // (and cannot throw). So only `+` -> ' ' remains, and often not even that.
    if (typeof str === 'string' && str.indexOf('%') === -1) {
        return str.indexOf('+') === -1 ? str : str.replace(/\+/g, ' ');
    }

    var strWithoutPlus = str.replace(/\+/g, ' ');
    if (charset === 'iso-8859-1') {
        // unescape never throws, no try...catch needed:
        return strWithoutPlus.replace(/%[0-9a-f]{2}/gi, unescape);
    }
    // utf-8
    try {
        return decodeURIComponent(strWithoutPlus);
    } catch (e) {
        return strWithoutPlus;
    }
};

var hasToPrimitive = typeof Symbol === 'function' && typeof Symbol.toPrimitive === 'symbol';
var arrayJoin = Array.prototype.join;
var arrayToString = Array.prototype.toString;
var objectToString = Object.prototype.toString;
var functionToString = Function.prototype.toString;
var isIntrinsicArrayMethod = function isIntrinsicArrayMethod(method, expected) {
    if (method === expected) {
        return true;
    }
    if (typeof method !== 'function' || functionToString.call(method) !== functionToString.call(expected)) {
        return false;
    }
    try {
        return Function.prototype.call.call(method, []) === '';
    } catch (error) {
        return false;
    }
};

var propertyDescriptor = function propertyDescriptor(value, key) {
    var current = value;
    while (current) {
        var descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor) {
            return descriptor;
        }
        current = Object.getPrototypeOf(current);
    }
};

var needsCoercion = function needsCoercion(value, visiting) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        return false;
    }
    var primitive = hasToPrimitive && propertyDescriptor(value, Symbol.toPrimitive);
    if (primitive && (!has.call(primitive, 'value') || primitive.value != null)) {
        return false;
    }
    var stringify = propertyDescriptor(value, 'toString');
    if (!stringify || (has.call(stringify, 'value') && typeof stringify.value !== 'function')) {
        return true;
    }
    var join = isArray(value) && propertyDescriptor(value, 'join');
    if (!join || !isIntrinsicArrayMethod(stringify.value, arrayToString) || !isIntrinsicArrayMethod(join.value, arrayJoin)) {
        return false;
    }
    var ancestors = visiting || getSideChannel();
    if (ancestors.has(value)) {
        return false;
    }
    ancestors.set(value, true);
    try {
        var length = Object.getOwnPropertyDescriptor(value, 'length').value;
        var current = value;
        while (current) {
            var keys = Object.getOwnPropertyNames(current);
            for (var index = 0; index < keys.length; index += 1) {
                var key = keys[index];
                var numeric = +key;
                if (String(numeric) === key && numeric >= 0 && numeric < length && Math.floor(numeric) === numeric) {
                    var item = propertyDescriptor(value, key);
                    if (has.call(item, 'value') && needsCoercion(item.value, ancestors)) {
                        return true;
                    }
                }
            }
            current = Object.getPrototypeOf(current);
        }
        return false;
    } finally {
        ancestors['delete'](value);
    }
};

var joinCoercible = function joinCoercible(value, joining) {
    var ancestors = joining || getSideChannel();
    if (ancestors.has(value)) {
        return '';
    }
    if (!needsCoercion(value)) {
        return arrayJoin.call(value, ',');
    }
    ancestors.set(value, true);
    try {
        var length = Math.min(Math.max(Math.floor(+value.length) || 0, 0), 0x1FFFFFFFFFFFFF);
        var result = '';
        for (var index = 0; index < length; index += 1) {
            if (index > 0) {
                result += ',';
            }
            var item = value[index];
            if (item != null) {
                result += arrayJoin.call([toCoercible(item, ancestors)], '');
            }
        }
        return result;
    } finally {
        ancestors['delete'](value);
    }
};

var toCoercible = function toCoercible(value, joining) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        return value;
    }
    if (!needsCoercion(value)) {
        return value;
    }
    if (hasToPrimitive && value[Symbol.toPrimitive] != null) {
        return value;
    }
    if (isArray(value) && isIntrinsicArrayMethod(value.toString, arrayToString) && isIntrinsicArrayMethod(value.join, arrayJoin)) {
        return joinCoercible(value, joining);
    }
    if (typeof value.toString === 'function') {
        return value;
    }
    var valueOf = value.valueOf;
    if (typeof valueOf === 'function') {
        var primitive = valueOf.call(value);
        if (!primitive || (typeof primitive !== 'object' && typeof primitive !== 'function')) {
            return String(primitive);
        }
    }
    return objectToString.call(value);
};

var limit = 1024;

/* eslint operator-linebreak: [2, "before"] */

var encode = function encode(str, defaultEncoder, charset, kind, format) {
    // This code was originally written by Brian White (mscdex) for the io.js core querystring library.
    // It has been adapted here for stricter adherence to RFC 3986
    if (str.length === 0) {
        return str;
    }

    var string = str;
    if (typeof str === 'symbol') {
        string = Symbol.prototype.toString.call(str);
    } else if (typeof str !== 'string') {
        string = String(toCoercible(str));
    }

    if (charset === 'iso-8859-1') {
        // `escape` leaves `+` untouched, but a literal `+` is decoded back to a space,
        // so it must be percent-encoded to round-trip (the utf-8 path already does this).
        return escape(string).replace(/%u[0-9a-f]{4}/gi, function ($0) {
            return '%26%23' + parseInt($0.slice(2), 16) + '%3B';
        }).replace(/\+/g, '%2B');
    }

    var out = '';
    for (var j = 0; j < string.length; j += limit) {
        var segment = string.length >= limit ? string.slice(j, j + limit) : string;
        if (j + limit < string.length) {
            var last = segment.charCodeAt(segment.length - 1);
            if (last >= 0xD800 && last <= 0xDBFF) {
                segment = segment.slice(0, -1);
                j -= 1;
            }
        }
        var arr = [];

        for (var i = 0; i < segment.length; ++i) {
            var c = segment.charCodeAt(i);
            if (
                c === 0x2D // -
                || c === 0x2E // .
                || c === 0x5F // _
                || (c === 0x7E && format !== formats.WHATWG) // ~
                || (c >= 0x30 && c <= 0x39) // 0-9
                || (c >= 0x41 && c <= 0x5A) // a-z
                || (c >= 0x61 && c <= 0x7A) // A-Z
                || (format === formats.RFC1738 && (c === 0x28 || c === 0x29)) // ( )
                || (format === formats.WHATWG && c === 0x2A) // *
            ) {
                arr[arr.length] = segment.charAt(i);
                continue;
            }

            if (c < 0x80) {
                arr[arr.length] = hexTable[c];
                continue;
            }

            if (c < 0x800) {
                arr[arr.length] = hexTable[0xC0 | (c >> 6)]
                    + hexTable[0x80 | (c & 0x3F)];
                continue;
            }

            if (c < 0xD800 || c >= 0xE000) {
                arr[arr.length] = hexTable[0xE0 | (c >> 12)]
                    + hexTable[0x80 | ((c >> 6) & 0x3F)]
                    + hexTable[0x80 | (c & 0x3F)];
                continue;
            }

            var next = segment.charCodeAt(i + 1);
            if (c <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
                i += 1;
                c = 0x10000 + (((c & 0x3FF) << 10) | (next & 0x3FF));

                arr[arr.length] = hexTable[0xF0 | (c >> 18)]
                    + hexTable[0x80 | ((c >> 12) & 0x3F)]
                    + hexTable[0x80 | ((c >> 6) & 0x3F)]
                    + hexTable[0x80 | (c & 0x3F)];
            } else {
                // a lone surrogate has no UTF-8 encoding; like `URLSearchParams` and `TextEncoder`, emit U+FFFD
                arr[arr.length] = '%EF%BF%BD';
            }
        }

        out += arr.join('');
    }

    return out;
};

var compact = function compact(value) {
    var queue = [{ obj: { o: value }, prop: 'o' }];
    var refs = getSideChannel();

    for (var i = 0; i < queue.length; ++i) {
        var item = queue[i];
        var obj = item.obj[item.prop];

        var keys = Object.keys(obj);
        for (var j = 0; j < keys.length; ++j) {
            var key = keys[j];
            var val = obj[key];
            if (typeof val === 'object' && val !== null && !refs.has(val)) {
                queue[queue.length] = { obj: obj, prop: key };
                refs.set(val, true);
            }
        }
    }

    compactQueue(queue);

    return value;
};

var isRegExp = function isRegExp(obj) {
    return Object.prototype.toString.call(obj) === '[object RegExp]';
};

var isBuffer = function isBuffer(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }

    return !!(obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj));
};

var combine = function combine(a, b, arrayLimit, plainObjects, throwOnLimitExceeded) {
    // If 'a' is already an overflow object, add to it
    if (isOverflow(a)) {
        if (throwOnLimitExceeded) {
            throw new RangeError('Array limit exceeded. Only ' + arrayLimit + ' element' + (arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
        }
        // spread `b` one level, matching the `[].concat(a, b)` used below, so a
        // collection appended to an already-overflowed object is flattened
        // rather than nested under a single index
        var bValues = isArray(b) ? b : [b];
        var newIndex = getMaxIndex(a);
        for (var i = 0; i < bValues.length; ++i) {
            newIndex = incrementIndex(newIndex);
            setProperty(a, newIndex, bValues[i]);
        }
        setMaxIndex(a, newIndex);
        return a;
    }

    var result = [].concat(a, b);
    if (result.length > arrayLimit) {
        if (throwOnLimitExceeded) {
            throw new RangeError('Array limit exceeded. Only ' + arrayLimit + ' element' + (arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
        }
        return markOverflow(arrayToObject(result, { plainObjects: plainObjects }), result.length - 1);
    }
    return result;
};

var maybeMap = function maybeMap(val, fn) {
    if (isArray(val)) {
        var mapped = [];
        for (var i = 0; i < val.length; i += 1) {
            mapped[mapped.length] = fn(val[i]);
        }
        return mapped;
    }
    return fn(val);
};

module.exports = {
    arrayToObject: arrayToObject,
    assign: assign,
    combine: combine,
    compact: compact,
    decode: decode,
    encode: encode,
    isBuffer: isBuffer,
    isOverflow: isOverflow,
    isRegExp: isRegExp,
    joinCoercible: joinCoercible,
    markOverflow: markOverflow,
    maybeMap: maybeMap,
    merge: merge,
    setProperty: setProperty,
    toCoercible: toCoercible
};
