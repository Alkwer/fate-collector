(() => {
  let sequence = 0;
  window.__asyncProbe = [];
  const log = (kind, data = {}) => {
    const row = { time: performance.now(), kind, ...data };
    window.__asyncProbe.push(row);
    console.debug('__async_probe__' + JSON.stringify(row));
  };
  const wrapRequest = (prototype, name) => {
    const native = prototype[name];
    prototype[name] = function (...args) {
      const id = ++sequence;
      const detail = { id, name, source: this.name || this.constructor.name };
      log('request-start', detail);
      const request = native.apply(this, args);
      for (const event of ['success', 'error', 'blocked', 'upgradeneeded']) request.addEventListener(event, () => log('request-' + event, detail));
      return request;
    };
  };
  wrapRequest(IDBFactory.prototype, 'open');
  for (const name of ['get', 'getKey', 'getAll', 'getAllKeys', 'put', 'add', 'delete', 'count', 'openCursor']) wrapRequest(IDBObjectStore.prototype, name);
  wrapRequest(IDBIndex.prototype, 'openCursor');
  const nativeTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const transaction = nativeTransaction.apply(this, args);
    const detail = { id: ++sequence, database: this.name, stores: args[0], mode: args[1], durability: transaction.durability };
    log('transaction-start', detail);
    for (const event of ['complete', 'abort', 'error']) transaction.addEventListener(event, () => log('transaction-' + event, detail));
    return transaction;
  };
  const promiseMethod = (target, name) => {
    const native = target[name];
    target[name] = function (...args) {
      const detail = { id: ++sequence, name };
      log('promise-start', detail);
      const promise = native.apply(this, args);
      promise.then(() => log('promise-resolve', detail), error => log('promise-reject', { ...detail, error: String(error) }));
      return promise;
    };
  };
  promiseMethod(Blob.prototype, 'text');
  promiseMethod(window, 'createImageBitmap');
  promiseMethod(window, 'fetch');
  promiseMethod(Response.prototype, 'json');
  setInterval(() => log('heartbeat'), 1000);
})();
