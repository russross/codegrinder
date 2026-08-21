if (!Atomics.waitAsync) {
    let availableWorkers = [];
    Atomics.waitAsync = (ia, index, value, timeout) => {
        if (Atomics.load(ia, index) != value) return { async: false, value: "not-equal" };
        if (timeout === 0) return { async: false, value: "timed-out" };
        return {
            async: true,
            value: new Promise(resolve => {
                const worker = availableWorkers.length > 0 ? availableWorkers.pop() : new Worker("data:application/javascript," + encodeURIComponent(`onmessage = e => postMessage(Atomics.wait(...e.data))`));
                worker.onmessage = e => {
                    availableWorkers.push(worker);
                    resolve(e.data);
                }
                worker.postMessage([ia, index, value, timeout]);
            })
        }
    }
}