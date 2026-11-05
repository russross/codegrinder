function createPrompt(message: string, initialValue = ""): Promise<string | null> {
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
    input.value = initialValue;
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

    function finish(value: string | null): void {
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

function createChoicePrompt<Choice extends string>(
  message: string,
  choices: readonly Choice[],
  initialChoice: Choice | null = null,
): Promise<Choice | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "prompt-overlay";

    const dialog = document.createElement("div");
    dialog.className = "prompt-container";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const heading = document.createElement("div");
    heading.className = "prompt-label";
    heading.textContent = message;

    const choiceButtons = document.createElement("div");
    choiceButtons.className = "prompt-choices";

    function finish(value: Choice | null): void {
      overlay.remove();
      resolve(value);
    }

    let firstButton: HTMLButtonElement | null = null;
    let initialButton: HTMLButtonElement | null = null;
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice;
      button.addEventListener("click", () => finish(choice));
      choiceButtons.appendChild(button);
      firstButton ??= button;
      if (choice === initialChoice) {
        initialButton = button;
      }
    }

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => finish(null));

    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        finish(null);
      }
    });

    dialog.append(heading, choiceButtons, cancelButton);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    (initialButton ?? firstButton ?? cancelButton).focus();
  });
}

export { createChoicePrompt, createPrompt };
