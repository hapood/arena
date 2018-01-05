import Store from "./Store";
import TaskManager from "../core/TaskManager";
import Reuni from "./Reuni";
import { Observer } from "./types";

export default class NodeItem {
  private _id: string;
  private _name: string;
  private _parent: NodeItem | undefined | null;
  private _children: Record<string, NodeItem>;
  private _stores: Record<string, Store>;
  private _dirtyStores: Record<string, boolean>;
  private _dirtyStoreKeys: Record<string, Record<string, boolean>>;
  private _dirtyNodes: Record<string, boolean>;
  private _isDestroyed: boolean;
  private _arenaStore: Reuni;

  constructor(
    id: string,
    name: string,
    arenaStore: Reuni,
    parent?: NodeItem
  ) {
    this._id = id;
    this._name = name;
    this._parent = parent;
    this._stores = {};
    this._children = {};
    this._dirtyNodes = {};
    this._dirtyStores = {};
    this._dirtyStoreKeys = {};
    this._isDestroyed = false;
    this._arenaStore = arenaStore;
  }

  getId() {
    return this._id;
  }

  isDestroyed() {
    return this._isDestroyed;
  }

  getParent() {
    return this._parent;
  }

  hasStores(storeNames: string[]) {
    let nullIndex = storeNames.findIndex(
      storeName => this._stores[storeName] == null
    );
    return nullIndex < 0 ? true : false;
  }

  destroy(): null | string[] {
    let observers: Observer[] = [];
    Object.values(this._stores).forEach(store => {
      observers.push(store.getObserver());
      store.destroy();
    });
    let nodeKeys = Object.keys(this._children);
    let keys = Object.entries(this._children)
      .map(([key, child]) => child.destroy())
      .reduce(
        (prev, cur) => (cur == null ? prev : (prev as string[]).concat(cur)),
        nodeKeys
      );
    this._stores = {};
    this._children = {};
    this._isDestroyed = true;
    return keys;
  }

  commit() {
    Object.keys(this._dirtyNodes).forEach(nodeId =>
      this._children[nodeId].commit()
    );
    Object.keys(this._dirtyStores).forEach(storeName =>
      this._stores[storeName].commit()
    );
    let dirtyStores = this._dirtyStoreKeys;
    this._dirtyNodes = {};
    this._dirtyStores = {};
    this._dirtyStoreKeys = {};
    this._arenaStore.updateDirtyNode(this._id, dirtyStores);
  }

  addDirtyStores(storeName: string) {
    this._dirtyStores[storeName] = true;
    if (this._parent != null) {
      this._parent.addDirtyNode(this._id);
    }
  }

  addDirtyNode(nodeId: string) {
    this._dirtyNodes[nodeId] = true;
  }

  updateDirtyStore(storeName: string, keyList: Record<string, boolean>) {
    this._dirtyStoreKeys[storeName] = keyList;
  }

  addStore<S extends Record<string, {}>, A>(
    storeName: string,
    RawStore: new () => any
  ) {
    if (this._stores[storeName] != null) {
      throw new Error(
        `Error occurred while adding store to node [${
          this._id
        }], store [${storeName}] already exist.`
      );
    }
    let store = new Store(storeName, RawStore, this);
    this._stores[storeName] = store;
    return store;
  }

  deleteStore(storeName: string) {
    let store = this._stores[storeName];
    if (this._stores[storeName] == null) {
      throw new Error(
        `Error occurred while deleting store to node [${
          this._id
        }], store [${storeName}] is not exist.`
      );
    }
    store.destroy();
    delete this._stores[storeName];
    return store;
  }

  mountChild(id: string, node: NodeItem) {
    if (this._children[id] != null) {
      throw new Error(
        `Error occurred while mounting node [${
          this._id
        }], child [${id}] already exist.`
      );
    }
    this._children[id] = node;
    return node;
  }

  unmountChild(nodeId: string) {
    let child = this._children[nodeId];
    if (child == null) {
      throw new Error(
        `Error occurred while unmounting in node [${
          this._id
        }], child [${nodeId}] does not exist.`
      );
    }
    delete this._children[nodeId];
    return child;
  }

  hasChild(nodeId: string) {
    return this._children[nodeId] != null;
  }

  getTaskManager() {
    return this._arenaStore.getTaskManager();
  }

  getStores() {
    return this._stores;
  }

  getNode() {
    return this._stores;
  }

  getArenaStore() {
    return this._arenaStore;
  }

  subscribe(
    care: Record<string, Record<string, string[]>>,
    cb: (isValid: boolean) => void
  ) {
    let observer = this._arenaStore.subscribe(this._id, care, cb);
    return observer;
  }

  getStoreEntity(storeName: string) {
    let store = this._stores[storeName];
    if (store == null) {
      throw new Error(
        `Error occurred while getting store, store [${storeName}] does not exist in node [${
          this._id
        }].`
      );
    }
    return store.getEntity();
  }

  findStoreEntity(storeName: string, nodeName = "$") {
    return this._arenaStore.getStoreEntity(this._id, nodeName, storeName);
  }
}
