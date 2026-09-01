interface FileNodeData {
  content: string;
  fileType?: string;
  children?: never;
}

interface DirectoryNodeData {
  children: Record<string, WorkspaceNode>;
  collapsed: boolean;
  content?: never;
}

type WorkspaceNode = DirectoryNodeData | FileNodeData;
type FileClickHandler = (fileNode: FileNodeData, path: string) => void;

function isDirectoryNode(node: WorkspaceNode): node is DirectoryNodeData {
  return node.children !== undefined;
}

function parseWorkspaceNode(value: unknown): WorkspaceNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Workspace node must be an object");
  }
  if ("children" in value) {
    if (typeof value.children !== "object" || value.children === null || Array.isArray(value.children)) {
      throw new Error("Workspace directory children must be an object");
    }
    const children: Record<string, WorkspaceNode> = {};
    for (const [name, child] of Object.entries(value.children)) {
      children[name] = parseWorkspaceNode(child);
    }
    return {
      children,
      collapsed: "collapsed" in value && typeof value.collapsed === "boolean" ? value.collapsed : true,
    };
  }
  if (!("content" in value) || typeof value.content !== "string") {
    throw new Error("Workspace file content must be a string");
  }
  const node: FileNodeData = { content: value.content };
  if ("fileType" in value && typeof value.fileType === "string") {
    node.fileType = value.fileType;
  }
  return node;
}

function parseDirectoryNode(value: unknown): DirectoryNodeData {
  const node = parseWorkspaceNode(value);
  if (!isDirectoryNode(node)) {
    throw new Error("Workspace root must be a directory");
  }
  return node;
}

function nameFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? "";
}

function extension(path: string): string {
  const parts = nameFromPath(path).split(".");
  return parts[parts.length - 1] ?? "";
}

class FileNode implements FileNodeData {
  content: string;
  fileType?: string;

  constructor(content = "") {
    this.content = content;
  }
}

class DirectoryNode implements DirectoryNodeData {
  children: Record<string, WorkspaceNode>;
  collapsed = true;

  constructor(children: Record<string, WorkspaceNode> = {}) {
    this.children = children;
  }
}

class FileSystem {
  rootNode: DirectoryNodeData;

  constructor(rootNode: DirectoryNodeData = new DirectoryNode()) {
    if (rootNode.children === undefined) {
      throw new Error("Filesystem must have directory for root");
    }
    this.rootNode = rootNode;
    this.rootNode.collapsed = false;
  }

  touch(path: string): FileNodeData {
    const parts = path.split("/");
    if (parts[0] !== "" || parts.length < 2) {
      throw new Error("Path must be absolute");
    }
    parts.shift();
    const name = parts.pop();
    if (name === undefined) {
      throw new Error("Path must name a file");
    }

    let currentNode = this.rootNode;
    for (const part of parts) {
      const child = currentNode.children[part] ?? new DirectoryNode();
      currentNode.children[part] = child;
      if (!isDirectoryNode(child)) {
        throw new Error("Cannot access children of FileNode");
      }
      currentNode = child;
    }

    const node = currentNode.children[name] ?? new FileNode();
    currentNode.children[name] = node;
    if (isDirectoryNode(node)) {
      throw new Error("Referenced Node is a DirectoryNode not a FileNode");
    }
    return node;
  }

  clear(): void {
    this.rootNode = new DirectoryNode();
    this.rootNode.collapsed = false;
  }
}

class FileSystemUI {
  fileClick: FileClickHandler;
  private readonly fileSystem: FileSystem;
  private readonly treeElement: HTMLElement;

  constructor(fileSystem: FileSystem, treeElement: HTMLElement, fileClick: FileClickHandler = () => {}) {
    this.fileSystem = fileSystem;
    this.treeElement = treeElement;
    this.fileClick = fileClick;
    this.refreshUI();
  }

  refreshUI(): void {
    this.treeElement.innerText = "";
    this.#presentNode(this.fileSystem.rootNode, this.treeElement, "");
  }

  #presentNode(node: WorkspaceNode, parentContainer: HTMLElement, path: string): void {
    const nodeName = nameFromPath(path);
    if (nodeName.startsWith(".")) {
      return;
    }

    const nodeElement = document.createElement("li");
    if (isDirectoryNode(node)) {
      nodeElement.innerText = `${nodeName}/`;
      nodeElement.classList.add("folder");
      if (node.collapsed) {
        nodeElement.classList.add("collapsed");
      }
      const childrenElement = document.createElement("ul");
      for (const [childName, child] of Object.entries(node.children)) {
        this.#presentNode(child, childrenElement, `${path}/${childName}`);
      }
      nodeElement.appendChild(childrenElement);
      nodeElement.addEventListener("click", (event) => {
        node.collapsed = !node.collapsed;
        nodeElement.classList.toggle("collapsed");
        event.stopPropagation();
      });
    } else {
      nodeElement.innerText = nodeName;
      nodeElement.classList.add("file");
      if (node.fileType !== undefined) {
        nodeElement.classList.add(node.fileType);
      }
      nodeElement.addEventListener("click", (event) => {
        this.fileClick(node, path);
        event.stopPropagation();
      });
    }
    parentContainer.appendChild(nodeElement);
  }
}

export {
  DirectoryNode,
  extension,
  FileNode,
  FileSystem,
  FileSystemUI,
  isDirectoryNode,
  nameFromPath,
  parseDirectoryNode,
};
export type { DirectoryNodeData, FileClickHandler, FileNodeData, WorkspaceNode };
