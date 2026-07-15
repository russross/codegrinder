function createPrompt(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "prompt-overlay";

    const form = document.createElement("form");
    form.className = "prompt-container";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");

    const label = document.createElement("label");
    label.className = "prompt-label";
    label.textContent = message;

    const input = document.createElement("input");
    input.className = "prompt-input";
    input.type = "text";
    label.appendChild(input);

    const buttons = document.createElement("div");
    buttons.className = "prompt-buttons";

    const okButton = document.createElement("button");
    okButton.type = "submit";
    okButton.textContent = "OK";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => finish(null));

    function finish(value) {
      overlay.remove();
      resolve(value);
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value);
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        finish(null);
      }
    });

    buttons.append(okButton, cancelButton);
    form.append(label, buttons);
    overlay.appendChild(form);
    document.body.appendChild(overlay);
    input.focus();
  });
}

export { createPrompt };
