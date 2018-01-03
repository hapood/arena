import Scene from "./Scene";
import Node from "./Node";
import TaskStatus from "../api/TaskStatus";
import PropertyType from "../api/PropertyType";

export type NodeDictItem = {
  path: string[];
  ref: Node;
  nameDict: Record<string, string>;
  name: string;
};

export type NodeDict = Record<string, NodeDictItem>;

export type TaskDictItem = {
  type: PropertyType;
  task: () => void;
};

export type TaskDict = Record<string, TaskDictItem>;

export type TaskItem = {
  id: string;
  isDone: boolean;
  isCanceled: boolean;
  observers: ((status: TaskStatus) => void)[];
};

export type NodeItem = {
  id: string;
  name: string;
  scenes: Record<string, Scene>;
  parent: NodeItem | null | undefined;
  children: Record<string, NodeItem>;
  isDestroyed: boolean;
};

export type Observer = {
  care: Record<string, Record<string, string[]>>;
  cb: (isValid: boolean) => void;
};
