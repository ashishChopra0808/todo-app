/**
 * Small polyfills for older iPhones (iOS 14–15.3). Every browser on iOS uses Safari's engine,
 * so these matter for Chrome on iPhone too. Imported first in main.tsx.
 */

if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', {
    value: (obj: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, key),
    configurable: true,
    writable: true,
  });
}

if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(crypto, 'randomUUID', {
    value: () => {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6]! & 0x0f) | 0x40; // version 4
      b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
    configurable: true,
    writable: true,
  });
}

if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    value: function at<T>(this: T[], i: number) {
      const n = Math.trunc(i) || 0;
      return this[n < 0 ? this.length + n : n];
    },
    configurable: true,
    writable: true,
  });
}

export {};
