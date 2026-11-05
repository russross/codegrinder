import { TerminalView } from '../terminal.ts';

const check = (condition, message) => { if (!condition) throw new Error(message); };
export async function run() {
    const original = HTMLCanvasElement.prototype.getContext;
    const host = document.createElement('div');
    host.style.cssText = 'width:600px;height:200px';
    document.body.append(host);
    let input = '';
    // Model unavailable GPU contexts without changing the terminal's fallback policy.
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
        return kind === 'webgl' || kind === 'webgl2' ? null : original.call(this, kind, ...args);
    };
    let terminal;
    try {
        terminal = new TerminalView(host, {onData:text => { input += text; }});
        await terminal.ready;
        terminal.write('DOM fallback\r\n┌──┐\r\n└──┘');
        check((await terminal.readText()).includes('┌──┐'), 'fallback lost Unicode output');
        check(host.querySelector('.xterm-rows'), 'fallback did not use the DOM renderer');
        check(getComputedStyle(host).backgroundColor === 'rgb(0, 0, 0)', 'fallback changed the black background');
        terminal.paste('hello');
        check(input === 'hello', 'fallback lost terminal input');
        terminal.write('obsolete'.repeat(2000));
        terminal.clear();
        terminal.write('fresh');
        check(await terminal.readText() === 'fresh', 'fallback reset replayed old output');
        const columns = terminal.cols;
        host.style.width = '350px';
        terminal.fit();
        check(terminal.cols < columns, 'fallback did not fit its container');
        const screen = host.querySelector('.xterm-screen').getBoundingClientRect();
        check(Math.abs(screen.top - host.getBoundingClientRect().top - 4) < 1, 'fallback screen is not top-aligned');
    } finally {
        terminal?.destroy();
        HTMLCanvasElement.prototype.getContext = original;
        host.remove();
    }
}
