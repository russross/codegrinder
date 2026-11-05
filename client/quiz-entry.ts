// Quiz handoff uses a URL fragment so the bearer key never enters HTTP request logs.
export async function acceptQuizSession(storeSessionKey: (key: string) => void): Promise<void> {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const handoff = fragment.get("quiz");
    if (handoff === null) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const parsed: unknown = JSON.parse(handoff);
    if (typeof parsed !== "object" || parsed === null || !("session" in parsed) || !("identity" in parsed)
        || typeof parsed.session !== "string" || typeof parsed.identity !== "string") {
        throw new Error("Invalid quiz session. Relaunch the assignment from Canvas.");
    }
    storeSessionKey(parsed.session);
    const dialog = document.createElement("dialog");
    const title = document.createElement("h2");
    title.textContent = "Verify student and assignment";
    const identity = document.createElement("p");
    identity.style.whiteSpace = "pre-line";
    identity.textContent = parsed.identity;
    const button = document.createElement("button");
    button.textContent = "Continue to assignment";
    dialog.append(title, identity, button);
    document.body.append(dialog);
    await new Promise<void>(resolve => {
        dialog.addEventListener("cancel", event => event.preventDefault());
        button.addEventListener("click", () => { dialog.close(); dialog.remove(); resolve(); }, { once: true });
        dialog.showModal();
    });
}

