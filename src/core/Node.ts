import Scene from "./Scene";
import SceneAPI from "../api/Scene";

export default class Node {
  id: string;
  name: string;
  scenes: Record<string, Scene>;
  children: Record<string, Node>;
  parent: Node | null | undefined;
  dirtySceneKeys: Record<string, Record<string, boolean>>;
  dirtyScenes: Record<string, boolean>;
  dirtyNodes: Record<string, boolean>;
  commitCb: (
    id: string,
    nodeDict: Record<string, Record<string, boolean>>
  ) => void;

  constructor(
    id: string,
    name: string,
    parent: Node | null | undefined,
    updateCb: (
      id: string,
      nodeDict: Record<string, Record<string, boolean>>
    ) => void
  ) {
    this.id = id;
    this.name = name;
    this.parent = parent;
    this.children = {};
    this.scenes = {};
    this.commitCb = updateCb;
    this.dirtyScenes = {};
    this.dirtySceneKeys = {};
    this.dirtyNodes = {};
  }

  destroy() {
    Object.values(this.scenes).forEach(scene => {
      scene.destroy();
    });
    Object.values(this.children).forEach(child => {
      child.destroy();
    });
  }

  commit() {
    Object.keys(this.dirtyNodes).forEach(nodeId =>
      this.children[nodeId].commit()
    );
    Object.keys(this.dirtyScenes).forEach(sceneName =>
      this.scenes[sceneName].commit()
    );
    let dirtyScenes = this.dirtySceneKeys;
    this.dirtyNodes = {};
    this.dirtyScenes = {};
    this.dirtySceneKeys = {};
    this.commitCb(this.id, dirtyScenes);
  }

  addDirtyScenes(sceneName: string) {
    this.dirtyScenes[sceneName] = true;
    if (this.parent != null) {
      this.parent.addDirtyNode(this.id);
    }
  }

  addDirtyNode(nodeId: string) {
    this.dirtyNodes[nodeId] = true;
  }

  updateDirtyScene(sceneName: string, keyList: Record<string, boolean>) {
    this.dirtySceneKeys[sceneName] = keyList;
  }

  addScene<S extends Record<string, {}>, A>(
    sceneName: string,
    RawScene: typeof SceneAPI
  ) {
    if (this.scenes[sceneName] != null) {
      throw new Error(
        `Error occurred while adding scene to node [${
          this.id
        }], scene [${sceneName}] already exist.`
      );
    }
    this.scenes[sceneName] = new Scene(sceneName, RawScene, this);
  }

  deleteScene(sceneName: string) {
    let scene = this.scenes[sceneName];
    if (this.scenes[sceneName] == null) {
      throw new Error(
        `Error occurred while deleting scene to node [${
          this.id
        }], scene [${sceneName}] is not exist.`
      );
    }
    scene.destroy();
    delete this.scenes[sceneName];
  }

  mountChild(id: string, node: Node) {
    if (this.children[id] != null) {
      throw new Error(
        `Error occurred while mounting node [${this.id}], child [${{
          id
        }}] already exist.`
      );
    }
    this.children[id] = node;
  }

  unmountChild(id: string) {
    if (this.children[id] != null) {
      throw new Error(
        `Error occurred while unmounting node [${this.id}], child [${{
          id
        }}] does not exist.`
      );
    }
    delete this.children[id];
  }

  getSceneEntity(sceneName: string) {
    let scene = this.scenes[sceneName];
    if (scene == null) {
      throw new Error(
        `Error occurred while getting scene, scene [${{
          sceneName
        }}] does not exist in node [${this.id}].`
      );
    }
    return scene.getEntity();
  }
}