import Store from "../core/Store";
import TaskManager from "../core/TaskManager";
import Node from "../core/Node";
import Reuni from "../core/Reuni";
import StoreObserver from "./StoreObserver";
import { nodeCareParser } from "./utils";
import { ObserverCB } from "./types";

function printInvalidWarn() {
  console.warn("Node has been unmounted.");
}

export default class NodeAPI {
  private _nodeItem: Node;

  constructor(nodeItem: Node) {
    this._nodeItem = nodeItem;
  }

  destroy() {
    if (this._nodeItem.isDestroyed() !== true) {
      let id = this._nodeItem.getId();
      this._nodeItem.getReuni().unmoutNode(id);
      return id;
    }
    return null;
  }

  getId() {
    return this._nodeItem.getId();
  }

  isDestroy() {
    return this._nodeItem.isDestroyed();
  }

  observe<K extends string>(observer: StoreObserver<K>, cb: ObserverCB) {
    if (this._nodeItem.isDestroyed() !== true) {
      let care = observer.getCareCate();
      let careDict = nodeCareParser(care, this._nodeItem);
      this._nodeItem.observe(careDict, cb);
    } else {
      printInvalidWarn();
    }
    return this;
  }

  addStore<K extends string>(
    storeName: string,
    RawStore: new () => any,
    storeOb?: StoreObserver<K> | null | undefined
  ) {
    if (this._nodeItem.isDestroyed() !== true) {
      let nodeItem = this._nodeItem;
      let careDict;
      if (storeOb != null) {
        careDict = nodeCareParser(storeOb.getCareCate(), this._nodeItem);
      }
      let store = this._nodeItem
        .getReuni()
        .addStore(nodeItem.getId(), storeName, RawStore, careDict);
      return this;
    } else {
      printInvalidWarn();
    }
    return this;
  }

  deleteStore(storeName: string) {
    let nodeItem = this._nodeItem;
    if (nodeItem.isDestroyed() !== true) {
      this._nodeItem.getReuni().deleteStore(nodeItem.getId(), storeName);
    } else {
      printInvalidWarn();
    }
    return this;
  }
}
