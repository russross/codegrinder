import { acceptQuizSession } from '../quiz-entry.ts';

function check(value, message) { if (!value) throw new Error(message); }
export async function run() {
    const identity = 'Student <img src=x onerror="window.injected=true">\nCourse\nQuiz';
    location.hash = 'quiz=' + encodeURIComponent(JSON.stringify({ session: 'fixture-session', identity }));
    let stored = '';
    let completed = false;
    const pending = acceptQuizSession(key => { stored = key; sessionStorage.setItem('quiz-fixture', key); })
        .then(() => { completed = true; });
    check(location.hash === '', 'handoff remains in browser URL');
    check(stored === 'fixture-session', 'bearer key was not handed to tab storage');
    const dialog = document.querySelector('dialog');
    check(dialog?.open, 'attendant verification dialog is missing');
    check(dialog.textContent.includes(identity), 'identity changed');
    check(dialog.querySelector('img') === null, 'identity interpreted as HTML');
    await Promise.resolve();
    check(!completed, 'assignment opened before confirmation');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    check(dialog.open, 'escape dismissed attendant confirmation');
    dialog.querySelector('button').click();
    await pending;
    check(completed && document.querySelector('dialog') === null, 'confirmation did not finish');
    await acceptQuizSession(() => { throw new Error('ordinary reload replaced session'); });
    check(sessionStorage.getItem('quiz-fixture') === 'fixture-session', 'tab session lost');
    location.hash = 'quiz=' + encodeURIComponent(JSON.stringify({ session: 42 }));
    let rejected = false;
    try { await acceptQuizSession(() => {}); } catch { rejected = true; }
    check(rejected && location.hash === '', 'invalid handoff was accepted or retained');
}
