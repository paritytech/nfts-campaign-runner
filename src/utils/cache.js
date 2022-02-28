const crypto = require('crypto');
const cache = {
  store: new Map(),
  getHash: function (data) {
    let hashed = crypto.createHash('MD5').update(data).digest('hex');
    return hashed;
  },
  set: function (key, value) {
    let keyHash = this.getHash(key);
    this.store.set(keyHash, value);
  },
  has: function (key) {
    let keyHash = this.getHash(key);
    return this.store.has(keyHash);
  },
  get: function (key) {
    let keyHash = this.getHash(key);
    return this.store.get(keyHash);
  },
  clear: function () {
    this.store.clear();
  },
};

module.exports = { cache };
