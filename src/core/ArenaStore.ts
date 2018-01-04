import { NodeDict, NodeDictItem, Observer } from "./types";
import { genId } from "./utils";
import Scene from "./Scene";
import NodeAPI from "../api/Node";
import TaskManager from "./TaskManager";
import NodeItem from "./Node";

export default class ArenaStore {
  private _nodeDict: NodeDict;
  private _rootId: string;
  private _observers: Observer[];
  private _dirtyNodes: Record<string, Record<string, Record<string, boolean>>>;
  private _taskManager: TaskManager;

  constructor() {
    let nodeId = genId();
    this._rootId = nodeId;
    let rootName = "$root";
    let rootNodeItem = new NodeItem(nodeId, rootName, this);
    this._nodeDict = {
      [nodeId]: {
        path: [nodeId],
        ref: rootNodeItem,
        nameDict: { $: nodeId },
        name: rootName
      }
    };
    this._taskManager = new TaskManager();
    this._observers = [];
    this._dirtyNodes = {};
  }

  getTaskManager() {
    return this._taskManager;
  }

  getNodeDict() {
    return this._nodeDict;
  }

  updateDirtyNode(
    nodeId: string,
    dirtyScenes: Record<string, Record<string, boolean>>
  ) {
    this._dirtyNodes[nodeId] = dirtyScenes;
  }

  mountNode(
    nodeId: string | undefined | null,
    nodeName: string,
    parentId?: string
  ) {
    let newNodeId = nodeId;
    if (newNodeId != null) {
      if (this._nodeDict[newNodeId] != null) {
        throw new Error(
          `Error occurred while mounting node, id [${newNodeId}] already exist.`
        );
      }
    } else {
      while (newNodeId == null) {
        newNodeId = genId();
        if (this._nodeDict[newNodeId] != null) {
          newNodeId = null;
        }
      }
    }
    let nodePath: string[];
    let pNode: NodeDictItem;
    if (parentId == null) {
      pNode = this._nodeDict[this._rootId];
    } else {
      pNode = this._nodeDict[parentId];
    }
    if (pNode == null) {
      throw new Error(
        `Error occurred while mounting node, parent [${parentId}] does not exist.`
      );
    }
    if (nodeName.indexOf("$") === 0) {
      throw new Error(
        'Error occurred while mounting node, name of node can not start with "$".'
      );
    }
    let newNode = new NodeItem(newNodeId, nodeName, this, pNode.ref);
    nodePath = pNode.path.concat(newNodeId);
    this._nodeDict[newNodeId] = {
      path: nodePath,
      ref: newNode,
      name: nodeName,
      nameDict: Object.assign({}, pNode.nameDict, {
        [pNode.name]: parentId,
        $: nodeId
      })
    };
    pNode.ref.mountChild(newNodeId, newNode);
    return new NodeAPI(newNode);
  }

  addScene(nodeId: string, sceneName: string, RawScene: new () => any) {
    let node = this._nodeDict[nodeId];
    if (node == null) {
      throw new Error(
        `Error occurred while adding scene, node [${nodeId}] does not exist.`
      );
    }
    let scene = node.ref.addScene(sceneName, RawScene);
    this._observers.forEach(observer => {
      let careNodeIdList = Object.keys(observer.care);
      let isObserver = false;
      for (let i = 0; i < careNodeIdList.length; i++) {
        let careNodeId = careNodeIdList[i];
        if (careNodeId === nodeId) {
          let careSceneNameList = Object.keys(observer.care[careNodeId]);
          for (let j = 0; j < careSceneNameList.length; j++) {
            if (sceneName === careSceneNameList[j]) {
              isObserver = true;
              break;
            }
          }
          break;
        }
      }
      if (isObserver !== false) {
        let isCb = true;
        let careNodeIdList = Object.keys(observer.care);
        for (let i = 0; i < careNodeIdList.length; i++) {
          let nodeId = careNodeIdList[i];
          let node = this.getNode(nodeId) as NodeItem;
          if (node.hasScenes(Object.keys(observer.care[nodeId])) !== true) {
            isCb = false;
            break;
          }
        }
        if (isCb !== false) {
          observer.cb(true);
        }
      }
    });
    return scene;
  }

  deleteScene(nodeId: string, sceneName: string) {
    let node = this._nodeDict[nodeId];
    if (node == null) {
      throw new Error(
        `Error occurred while deleting scene, node [${nodeId}] does not exist.`
      );
    }
    let scene = node.ref.deleteScene(sceneName) as Scene;
    this.unsubscribe([scene.getObserver()]);
    this._observers.forEach(observer => {
      let careNodeIdList = Object.keys(observer.care);
      for (let i = 0; i < careNodeIdList.length; i++) {
        let careNodeId = careNodeIdList[i];
        if (careNodeId === nodeId) {
          let careSceneNameList = Object.keys(observer.care[careNodeId]);
          for (let j = 0; j < careSceneNameList.length; j++) {
            if (sceneName === careSceneNameList[j]) {
              observer.cb(false);
              break;
            }
          }
          break;
        }
      }
    });
    return scene;
  }

  unmoutNode(nodeId: string) {
    let node = this._nodeDict[nodeId];
    if (node == null) {
      throw new Error(
        `Error occurred while unmounting node, node [${nodeId}] does not exist.`
      );
    }
    let nodeKeys = node.ref.destroy();
    let parent = node.ref.getParent();
    if (parent != null) {
      parent.unmountChild(nodeId);
    }
    if (nodeKeys != null) {
      nodeKeys.forEach(key => {
        delete this._nodeDict[key];
      });
    }
    delete this._nodeDict[nodeId];
    let newObservers: Observer[] = [];
    this._observers.forEach(observer => {
      let isValid = true;
      let careNodeIdList = Object.keys(observer.care);
      for (let i = 0; i < careNodeIdList.length; i++) {
        let careNodeId = careNodeIdList[i];
        if (careNodeId === nodeId) {
          isValid = false;
          break;
        }
      }
      if (isValid !== false) {
        newObservers.push(observer);
      }
    });
    this._observers = newObservers;
    return node.ref;
  }

  subscribe(
    anchorId: string,
    care: Record<string, Record<string, string[]>>,
    cb: (isValid: boolean) => void
  ) {
    let anchorNode = this._nodeDict[anchorId];
    let node;
    let newCare: Record<string, Record<string, string[]>> = {};
    Object.keys(care).map(nodeName => {
      let nodeId;
      if (nodeName == "$") {
        node = anchorNode;
        nodeId = anchorId;
      } else {
        nodeId = anchorNode.nameDict[nodeName];
        if (nodeId == null) {
          throw new Error(
            `Error occurred while adding observer to node [${anchorId}], parent node with name [${nodeName}] does not exist.`
          );
        }
        node = this._nodeDict[nodeId];
      }
      if (node == null) {
        throw new Error(
          `Error occurred while adding observer to node, node [${nodeId}] does not exist.`
        );
      }
      newCare[nodeId] = care[nodeName];
    });
    let curObserver: Observer = { care: newCare, cb };
    this._observers.push(curObserver);
    return curObserver;
  }

  unsubscribe(observers: Observer[]) {
    this._observers = this._observers.filter(
      observer => !observers.includes(observer)
    );
  }

  commit() {
    let rootNode = this._nodeDict[this._rootId];
    if (rootNode == null) {
      throw new Error(
        `Error occurred while committing, root node [${
          this._rootId
        }] does not exist.`
      );
    }
    rootNode.ref.commit();
    this._observers.forEach(observer => {
      let careNodeIdList = Object.keys(observer.care);
      for (let i = 0; i < careNodeIdList.length; i++) {
        let nodeId = careNodeIdList[i];
        let dirtyScenes = this._dirtyNodes[nodeId];
        if (dirtyScenes != null) {
          let careSceneNameList = Object.keys(observer.care[nodeId]);
          for (let j = 0; j < careSceneNameList.length; j++) {
            let sceneName = careSceneNameList[j];
            let dirtyKeys = dirtyScenes[sceneName];
            if (dirtyKeys != null) {
              let careKeyList = observer.care[nodeId][sceneName];
              for (let k = 0; k < careKeyList.length; k++) {
                let key = careKeyList[k];
                if (dirtyKeys[key] != null) {
                  observer.cb(true);
                }
              }
            }
          }
        }
      }
    });
    this._dirtyNodes = {};
  }

  getSceneEntity(anchorId: string, nodeName: string, sceneName: string) {
    let anchorNode = this._nodeDict[anchorId];
    if (anchorNode == null) {
      throw new Error(
        `Error occurred while getting scene, anchor node [${anchorId}] does not exist.`
      );
    }
    let node;
    if (nodeName == "$") {
      node = anchorNode;
    } else {
      let nodeId = anchorNode.nameDict[nodeName];
      if (nodeId == null) {
        throw new Error(
          `Error occurred while getting scene, parent node with name [${nodeName}] does not exist.`
        );
      }
      node = this._nodeDict[nodeId];
      if (node == null) {
        throw new Error(
          `Error occurred while getting scene, node [${nodeId}] does not exist.`
        );
      }
    }
    return node.ref.getSceneEntity(sceneName);
  }

  getNode(nodeId: string) {
    let nodeItem = this._nodeDict[nodeId];
    if (nodeItem == null) {
      return null;
    }
    return nodeItem.ref;
  }
}

export function createArena(stateTree?: NodeItem) {
  return new ArenaStore();
}
