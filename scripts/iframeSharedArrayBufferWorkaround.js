// This is an ugly workaround but there is no other synchronous way
// to wait for something in a worker. I don't care if it is slower than
// native SharedArrayBuffer by 10000 times. It is the only way to fit the usecase without
// rearchitecting the entire codebase to use some slower method rather than SharedArrayBuffer.
if (!globalThis.SharedArrayBuffer) {
  const localSabs = {};
  globalThis.SharedArrayBuffer = class {
    constructor(bytes) {
      const obj = new ArrayBuffer(bytes);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', `./ponyfill/SharedArrayBuffer/${bytes}`, false); // The `false` parameter enables synchronous mode
      xhr.send("[]");
      obj.identifier = xhr.responseText;
      return obj;
    }
  }
  function send(xhr, int32arr) {
    if (!(int32arr.buffer.identifier in localSabs)) {
      localSabs[int32arr.buffer.identifier] = Array.from(new Int8Array(int32arr.buffer.length));
    }
    const prev = localSabs[int32arr.buffer.identifier];
    const curr = Array.from(new Int8Array(int32arr.buffer));
    localSabs[int32arr.buffer.identifier] = curr;
    xhr.send(JSON.stringify({ prev, curr }));
  }
  globalThis.Atomics ||= {};
  globalThis.Atomics.load = (arr, index) => { return arr[index] };
  globalThis.Atomics.store = (arr, index, value) => { arr[index] = value };
  globalThis.Atomics.wait = (int32arr, index, value, timeout = Infinity) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `./ponyfill/Atomics.wait/${int32arr.buffer.identifier}/${index + int32arr.byteOffset / 4}/${value}/${timeout}`, false);
    send(xhr, int32arr);
    const json = JSON.parse(xhr.responseText);
    const arr = json.buffer;
    for (let i = 0; i < arr.length; i++) {
      new Int8Array(int32arr.buffer)[i] = arr[i];
      localSabs[int32arr.buffer.identifier][i] = arr[i];
    }
    return json.value;
  }
  globalThis.Atomics.waitAsync = (int32arr, index, value, timeout = Infinity) => {
    return {
      async: true, value: new Promise(function (resolve) {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `./ponyfill/Atomics.wait/${int32arr.buffer.identifier}/${index + int32arr.byteOffset / 4}/${value}/${timeout}`, true);
        xhr.onload = function () {
          const json = JSON.parse(xhr.responseText);
          const arr = json.buffer;
          for (let i = 0; i < arr.length; i++) {
            new Int8Array(int32arr.buffer)[i] = arr[i];
            // Might need to merge in the future
            localSabs[int32arr.buffer.identifier][i] = arr[i];
          }
          resolve(json.value);
        };
        xhr.onerror = async function () {
          // The service worker reset due to inactivity
          // Call handling of sharedArrayBuffer loss
          window.iframeSharedArrayBufferWorkaroundServiceWorkerLoss();
        }
        send(xhr, int32arr);
      })
    }
  }
  globalThis.Atomics.notify = (int32arr, index, count = Infinity) => {
    const xhr = new XMLHttpRequest();
    // Only edge browser (even though chromium based?), doesn't send async network requests until returning to event loop
    // In the JavaScript worker, this results in not being able to notify the main thread that stdout has been written to until the script stops running.
    // Therefore in the worker this needs to be synchronous
    xhr.open('POST', `./ponyfill/Atomics.notify/${int32arr.buffer.identifier}/${index + int32arr.byteOffset / 4}/${count}`, !(typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope));
    send(xhr, int32arr);
  }
}
