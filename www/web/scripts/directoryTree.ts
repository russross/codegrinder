type WorkspaceFiles = Record<string, Uint8Array>;
type FileClickHandler = (content: Uint8Array, path: string) => void;

interface FileTreeNode {
  readonly kind: "file";
}

interface DirectoryTreeNode {
  readonly children: Record<string, DirectoryTreeNode | FileTreeNode>;
  readonly kind: "directory";
}

function pathParts(path: string): string[] {
  const parts = path.split("/");
  if (parts[0] !== "" || parts.length < 2 || parts.at(-1) === "") {
    throw new Error(`Workspace path must name an absolute file: ${JSON.stringify(path)}`);
  }
  parts.shift();
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Workspace path is not normalized: ${JSON.stringify(path)}`);
  }
  return parts;
}

function nameFromPath(path: string): string {
  return path.split("/").at(-1) ?? "";
}

function extension(path: string): string {
  return nameFromPath(path).split(".").at(-1) ?? "";
}

function buildDirectoryTree(files: Readonly<WorkspaceFiles>): DirectoryTreeNode {
  const root: DirectoryTreeNode = { children: {}, kind: "directory" };
  for (const path of Object.keys(files).sort()) {
    const parts = pathParts(`/${path}`);
    const fileName = parts.pop();
    if (fileName === undefined) {
      throw new Error(`Workspace path does not name a file: ${JSON.stringify(path)}`);
    }
    let directory = root;
    for (const part of parts) {
      const existing = directory.children[part];
      if (existing?.kind === "file") {
        throw new Error(`Workspace path crosses file ${JSON.stringify(part)}`);
      }
      if (existing === undefined) {
        directory.children[part] = { children: {}, kind: "directory" };
      }
      const child = directory.children[part];
      if (child?.kind !== "directory") {
        throw new Error(`Workspace path crosses file ${JSON.stringify(part)}`);
      }
      directory = child;
    }
    if (directory.children[fileName]?.kind === "directory") {
      throw new Error(`Workspace file collides with directory ${JSON.stringify(path)}`);
    }
    directory.children[fileName] = { kind: "file" };
  }
  return root;
}

class FileSystem {
  files: WorkspaceFiles;

  constructor(files: WorkspaceFiles = {}) {
    this.files = files;
    buildDirectoryTree(files);
  }

  load(files: WorkspaceFiles): void {
    buildDirectoryTree(files);
    this.files = files;
  }

  readFile(path: string): Uint8Array {
    pathParts(path);
    const content = this.files[path.slice(1)];
    if (content === undefined) {
      throw new Error(`Workspace file not found: ${JSON.stringify(path)}`);
    }
    return content;
  }

  writeFile(path: string, content: Uint8Array): void {
    pathParts(path);
    const relativePath = path.slice(1);
    const nextFiles = { ...this.files, [relativePath]: content };
    buildDirectoryTree(nextFiles);
    this.files = nextFiles;
  }
}

class FileSystemUI {
  fileClick: FileClickHandler;
  readonly #expandedPaths = new Set<string>();
  readonly #fileSystem: FileSystem;
  readonly #treeElement: HTMLElement;

  constructor(fileSystem: FileSystem, treeElement: HTMLElement, fileClick: FileClickHandler = () => {}) {
    this.#fileSystem = fileSystem;
    this.#treeElement = treeElement;
    this.fileClick = fileClick;
    this.refreshUI();
  }

  refreshUI(): void {
    this.#treeElement.replaceChildren();
    this.#presentDirectory(buildDirectoryTree(this.#fileSystem.files), this.#treeElement, "");
  }

  #presentDirectory(directory: DirectoryTreeNode, parent: HTMLElement, path: string): void {
    for (const [name, node] of Object.entries(directory.children)) {
      if (name.startsWith(".")) {
        continue;
      }
      const childPath = `${path}/${name}`;
      const item = document.createElement("li");
      item.innerText = node.kind === "directory" ? `${name}/` : name;
      item.classList.add(node.kind === "directory" ? "folder" : "file");
      if (node.kind === "directory") {
        const children = document.createElement("ul");
        this.#presentDirectory(node, children, childPath);
        item.appendChild(children);
        item.classList.toggle("collapsed", !this.#expandedPaths.has(childPath));
        item.addEventListener("click", (event) => {
          if (this.#expandedPaths.has(childPath)) {
            this.#expandedPaths.delete(childPath);
          } else {
            this.#expandedPaths.add(childPath);
          }
          item.classList.toggle("collapsed");
          event.stopPropagation();
        });
      } else {
        item.addEventListener("click", (event) => {
          this.fileClick(this.#fileSystem.readFile(childPath), childPath);
          event.stopPropagation();
        });
      }
      parent.appendChild(item);
    }
  }
}

export { extension, FileSystem, FileSystemUI, nameFromPath };
export type { FileClickHandler, WorkspaceFiles };
