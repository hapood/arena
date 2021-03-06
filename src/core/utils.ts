import {
  TaskDict,
  NodeNameDict,
  NodeThreadDict,
  ObserverCareDict,
  StoreValidDict,
  NodeInitInfo,
  KeyCareItem
} from "./types";
import PropertyType from "../api/PropertyType";
import Store from "./Store";
import TaskManager from "./TaskManager";
import TaskHandler, { tKey } from "../api/TaskHandler";
import TaskStatus from "../api/TaskStatus";
import Reuni from "./Reuni";
import Node from "./Node";
import TaskCancelError from "../api/TaskCancelError";
import StoreNotExistError from "../api/StoreNotExistError";
import StoreNotAvailableError from "../api/StoreNotAvailableError";
import ObserveType from "../api/ObserveType";

export function genId() {
  return (
    "_" +
    Math.random()
      .toString(36)
      .substr(2, 9)
  );
}

export function buildStoreEntity(store: Store, reuni: Reuni): any {
  let state = store.getCommittedState();
  let valueDict = store.getValueDict();
  let taskDict = store.getTaskDict();
  let handler = {
    get: function(target: Store, name: string) {
      if (valueDict[name] != null) {
        return state[name];
      }
      if (taskDict[name] != null) {
        return preIgnite(target, name);
      }
      let storeDict = target.getStoreDict();
      if (storeDict[name] != null) {
        return target.getState()[name];
      }
    },
    set: function(target: Store, name: string, value: any) {
      throwErrorOfStore(target);
      if (valueDict[name] != null) {
        target.setValue(name, value);
        reuni.commit();
        return true;
      }
      throw new Error(
        `Error occurred while writting store [${target.getName()}], property [${name}] is not value.`
      );
    }
  };
  let entity = new Proxy(store, handler);
  return entity as any;
}

export function buildTaskEntity(store: Store, reuni: Reuni, t: TaskHandler) {
  let handler = {
    get: function(target: Store, name: string | symbol) {
      throwErrorOfStore(target);
      let state = target.getState();
      let valueDict = target.getValueDict();
      if (valueDict[name] != null) {
        return state[name];
      }
      let taskDict = target.getTaskDict();
      if (taskDict[name] != null) {
        if (taskDict[name].type === PropertyType.ASYNC_TASK) {
          reuni.commit();
        }
        let taskFunc = forkTask.bind(
          null,
          taskDict[name].task,
          target,
          reuni,
          t
        );
        taskFunc[tKey] = [name, target, t];
        return taskFunc;
      }
      let innerStore = target.getStoreDict()[name];
      if (innerStore != null) {
        return innerStore.getTaskEntity(t);
      }
    },
    set: function(target: Store, name: string, value: any) {
      throwErrorOfStore(target);
      let state = target.getState();
      let valueDict = target.getValueDict();
      if (valueDict[name] != null) {
        if (t.isCanceled() !== true && t.isDone() !== true) {
          target.setValue(name, value);
          return true;
        }
        throw new TaskCancelError(
          t.getId(),
          `Can not set [${name}] with value [${value}] in store [${target.getName()}]`
        );
      }
      throw new Error(
        `Error occurred while writting store [${target.getName()}] in task [${t.getId()}], property [${name}] is not value.`
      );
    }
  };
  let entity = new Proxy(store, handler);
  return entity as any;
}

function forkTask(
  f: () => void,
  store: Store,
  reuni: Reuni,
  t: TaskHandler,
  ...args: any[]
) {
  if (store.isValid() !== false) {
    let entity = buildTaskEntity(store, reuni, t);
    return f.apply(entity, args);
  }
  return null;
}

function throwErrorOfStore(store: Store) {
  if (store.isDestroy() !== false) {
    throw new StoreNotExistError(store);
  }
  if (store.isValid() !== true) {
    throw new StoreNotAvailableError(store);
  }
}

function registerStoreTask(
  store: Store,
  taskName: string,
  reuni: Reuni,
  t: TaskHandler
) {
  store.addTask(taskName, t);
  t.observe((tStatus: TaskStatus) => {
    if (process.env.NODE_ENV !== "production") {
      if (tStatus === TaskStatus.CANCELED) {
        console.info(
          `TaskHandler [${taskName}] is canceled, taskId: ${t.getId()}.`
        );
      } else {
        console.info(
          `TaskHandler [${taskName}] is done, taskId: ${t.getId()}.`
        );
      }
    }
    if (tStatus === TaskStatus.CANCELED) {
      store.deleteTask(taskName, t.getId());
      reuni.commit();
    }
  });
  return t;
}

export function preIgnite(
  store: Store,
  taskName: string,
  parentTask?: TaskHandler
) {
  let taskDict = store.getTaskDict();
  if (taskDict[taskName].type === PropertyType.TASK) {
    return syncTaskIgnite.bind(null, store, taskName, parentTask);
  } else {
    return asyncTaskIgnite.bind(null, store, taskName, parentTask);
  }
}

function syncTaskIgnite(
  store: Store,
  taskName: string,
  parentTask: TaskHandler | null | undefined,
  ...args: any[]
) {
  throwErrorOfStore(store);
  let reuni = store.getNode().getReuni();
  let taskManager = reuni.getTaskManager();
  let t = taskManager.startTask(parentTask);
  registerStoreTask(store, taskName, reuni, t);
  let entity = buildTaskEntity(store, reuni, t);
  let taskDict = store.getTaskDict();
  let f = taskDict[taskName].task;
  let r;
  try {
    r = f.apply(entity, args);
    taskManager.finishTask(t.getId());
    reuni.commit();
    return r;
  } catch (e) {
    if (e instanceof TaskCancelError) {
      if (process.env.NODE_ENV !== "production") {
        console.info(e);
      }
    } else {
      throw e;
    }
  }
  return null;
}

function asyncTaskIgnite(
  store: Store,
  taskName: string,
  parentTask: TaskHandler | null | undefined,
  ...args: any[]
) {
  throwErrorOfStore(store);
  let reuni = store.getNode().getReuni();
  let taskManager = reuni.getTaskManager();
  let t = taskManager.startTask(parentTask);
  registerStoreTask(store, taskName, reuni, t);
  let entity = buildTaskEntity(store, reuni, t);
  let taskDict = store.getTaskDict();
  let f = taskDict[taskName].task;
  let r = (f.apply(entity, args) as Promise<any>).catch((e: any) => {
    if (e instanceof TaskCancelError) {
      if (process.env.NODE_ENV !== "production") {
        console.info(e);
      }
    } else {
      throw e;
    }
  });
  r.then(() => {
    let tid = t.getId();
    taskManager.finishTask(tid);
    store.deleteTask(taskName, tid);
    reuni.commit();
  });
  (r as any)[tKey] = t;
  return r;
}

export function buildNodeNameDict(node: NodeInitInfo): NodeNameDict {
  let oldNameDict,
    parentNode = node.parent,
    threadSymbol = node.thread,
    nodeName = node.name;
  if (parentNode != null) {
    oldNameDict = parentNode.getNameDict();
  } else {
    oldNameDict = {};
  }
  if (nodeName == null) {
    return Object.assign({}, oldNameDict);
  }
  let nameItem = oldNameDict[nodeName];
  let newNameItem;
  if (nameItem == null) {
    newNameItem = {
      symbol: threadSymbol,
      ids: [node.id]
    };
  } else {
    if (nameItem.symbol !== threadSymbol) {
      throw new Error(
        `Error occurred generating node name dict, name [${nodeName}] is conflict.`
      );
    }
    newNameItem = Object.assign({}, nameItem, {
      ids: [node.id].concat(nameItem.ids)
    });
  }
  return Object.assign({}, oldNameDict, {
    [nodeName]: newNameItem
  });
}

export function buildNodeThreadDict(node: NodeInitInfo): NodeThreadDict {
  let oldThreads,
    parentNode = node.parent,
    threadSymbol = node.thread;
  if (parentNode != null) {
    oldThreads = parentNode.getThreadDict();
  } else {
    oldThreads = {};
  }
  let threadItem = oldThreads[threadSymbol];
  let newThreadItem;
  if (threadItem == null) {
    newThreadItem = [node.id];
  } else {
    newThreadItem = [node.id].concat(threadItem);
  }
  return Object.assign({}, oldThreads, {
    [threadSymbol]: newThreadItem
  });
}

export function buildStoreDict(careDict: ObserverCareDict, reuni: Reuni) {
  let dict: any = {};
  Object.entries(careDict).forEach(([nodeId, storeCareDict]) => {
    Object.entries(storeCareDict).map(([storeName, careItem]) => {
      dict[careItem.rename || storeName] = reuni.getStore(nodeId, storeName);
    });
  });
  return dict;
}

export function isStoreCare(
  care: ObserverCareDict,
  nodeId: string,
  storeName: string
) {
  let careNodeIdList = Object.keys(care);
  let isCare = false;
  for (let i = 0; i < careNodeIdList.length; i++) {
    let careNodeId = careNodeIdList[i];
    if (careNodeId === nodeId) {
      let careStoreNameList = Object.keys(care[careNodeId]);
      for (let j = 0; j < careStoreNameList.length; j++) {
        if (storeName === careStoreNameList[j]) {
          isCare = true;
          break;
        }
      }
      break;
    }
  }
  return isCare;
}

export function isCareNode(care: ObserverCareDict, nodeId: string) {
  let careNodeIdList = Object.keys(care);
  let isCare = false;
  for (let i = 0; i < careNodeIdList.length; i++) {
    let careNodeId = careNodeIdList[i];
    if (careNodeId === nodeId) {
      isCare = true;
      break;
    }
  }
  return isCare;
}

export function isCareStoreValid(
  care: ObserverCareDict,
  storeValidDict: StoreValidDict
) {
  let isCb = true;
  let careNodeIdList = Object.keys(care);
  for (let i = 0; i < careNodeIdList.length; i++) {
    let nodeId = careNodeIdList[i];
    let storeValid = storeValidDict[nodeId];
    let storeCareDict = care[nodeId];
    let storeNames = Object.keys(storeCareDict);
    for (let i = 0; i < storeNames.length; i++) {
      let storeObj = storeValid[storeNames[i]];
      if (storeObj == null || storeObj.isValid() !== true) {
        isCb = false;
        break;
      }
    }
  }
  return isCb;
}

export function storeObserveMatch(
  dirtyKeys: Record<string, boolean>,
  keyObserve: KeyCareItem
) {
  switch (keyObserve.type) {
    case ObserveType.ALL:
      return true;
    case ObserveType.INCLUDE:
      return storeObserveInclude(dirtyKeys, keyObserve.keys);
    case ObserveType.EXCLUDE:
      return storeObserveInclude(dirtyKeys, keyObserve.keys);
    default:
      return false;
  }
}

function storeObserveInclude(
  dirtyKeys: Record<string, boolean>,
  keys: string[]
) {
  for (let k = 0; k < keys.length; k++) {
    let key = keys[k];
    if (dirtyKeys[key] != null) {
      return true;
    }
  }
  return false;
}

export function isCareStoreDirty(
  care: ObserverCareDict,
  dirtyNodes: Record<string, Record<string, Record<string, boolean>>>
) {
  let isCb = false;
  let careNodeIdList = Object.keys(care);
  for (let i = 0; i < careNodeIdList.length; i++) {
    let nodeId = careNodeIdList[i];
    let dirtyStores = dirtyNodes[nodeId];
    if (dirtyStores != null) {
      let storeObserve = care[nodeId];
      let careStoreNameList = Object.keys(storeObserve);
      for (let j = 0; j < careStoreNameList.length; j++) {
        let storeName = careStoreNameList[j];
        let dirtyKeys = dirtyStores[storeName];
        if (dirtyKeys != null) {
          let keyObserve = storeObserve[storeName];
          isCb = storeObserveMatch(dirtyKeys, keyObserve);
          if (isCb !== false) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

export function buildEntityDict(careDict: ObserverCareDict, reuni: Reuni) {
  let dict: any = {};
  Object.entries(careDict).forEach(([nodeId, storeCareDict]) => {
    Object.entries(storeCareDict).map(([storeName, careItem]) => {
      dict[careItem.rename || storeName] = reuni.getEntity(nodeId, storeName);
    });
  });
  return dict;
}
