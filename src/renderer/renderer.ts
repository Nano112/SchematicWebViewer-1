import type { Block } from '@enginehub/schematicjs';
import { loadSchematic } from '@enginehub/schematicjs';
import type { SchematicHandles } from '.';
import type { GetClientJarUrlProps, SchematicRenderOptions } from './types';
import { getModelLoader } from './model/loader';
import { getResourceLoader } from '../resource/resourceLoader';
import type { BlockModelData } from './model/types';
import { POSSIBLE_FACES } from './model/types';
import {
    faceToFacingVector,
    INVISIBLE_BLOCKS,
    NON_OCCLUDING_BLOCKS,
    parseNbt,
} from './utils';
import { loadBlockStateDefinition } from './model/parser';
import { addArrowToScene, addBarsToScene } from './shapes';

import {
    ArcRotateCamera,
    Color3,
    Color4,
    Engine,
    WebGPUEngine,
    HemisphericLight,
    Mesh,
    MeshBuilder,
    Scene,
    ScenePerformancePriority,
    Vector3,
    Texture,
    InstancedMesh,
} from '@babylonjs/core';

import { GridMaterial } from '@babylonjs/materials';
// import { Inspector } from '@babylonjs/inspector';

const CASSETTE_DECK_URL = `https://services.enginehub.org/cassette-deck/minecraft-versions/find?dataVersion=`;
const URL_1_13 =
    'https://launcher.mojang.com/v1/objects/c0b970952cdd279912da384cdbfc0c26e6c6090b/client.jar';

async function getClientJarUrlDefault({
    dataVersion,
    corsBypassUrl,
}: GetClientJarUrlProps): Promise<string> {
    const versionManifestFile = dataVersion
        ? await (
              await fetch(`${corsBypassUrl}${CASSETTE_DECK_URL}${dataVersion}`)
          ).json()
        : undefined;

    return `${corsBypassUrl}${
        versionManifestFile?.[0]?.clientJarUrl ?? URL_1_13
    }`;
}

function getCameraSetup(
    scene: Scene,
    cameraOffset: number,
    canvas: HTMLCanvasElement
): ArcRotateCamera {
    const camera = new ArcRotateCamera(
        'camera',
        -Math.PI / 2,
        Math.PI / 2.5,
        10,
        new Vector3(0, 0, 0),
        scene
    );
    camera.wheelPrecision = 50;
    camera.attachControl(false, true);
    camera.radius = cameraOffset * 3;
    camera.attachControl(canvas, true);
    return camera;
}

function createLight(scene: Scene): HemisphericLight {
    const light = new HemisphericLight('light1', new Vector3(1, 1, 0), scene);
    light.specular = new Color3(0, 0, 0);
    return light;
}

function setSceneColor(color: string | number, scene: Scene) {
    if (color !== 'transparent') {
        scene.clearColor = Color4.FromHexString(`#${color.toString(16)}FF`);
    } else {
        scene.clearColor = new Color4(0, 0, 0, 0);
    }
}

function getSceneSetup(engine: Engine, backgroundColor: number | string) {
    const scene = new Scene(engine, {
        useGeometryUniqueIdsMap: true,
        useClonedMeshMap: true,
    });
    scene.performancePriority = ScenePerformancePriority.Intermediate;
    scene.renderingManager.maintainStateBetweenFrames = true;
    scene.skipFrustumClipping = true;
    setSceneColor(backgroundColor, scene);
    createLight(scene);
    return scene;
}

async function updateBlockModelLookup(
    blockModelLookup: Map<string, BlockModelData>,
    loadedSchematic: ReturnType<typeof loadSchematic>,
    resourceLoader: Promise<ReturnType<typeof getResourceLoader>>,
    modelLoader: ReturnType<typeof getModelLoader>
): Promise<Map<string, BlockModelData>> {
    for (const block of loadedSchematic.blockTypes) {
        if (INVISIBLE_BLOCKS.has(block.type)) {
            continue;
        }

        if (blockModelLookup.get(hashBlockForMap(block))) {
            continue;
        }
        const blockState = await loadBlockStateDefinition(
            block.type,
            await resourceLoader
        );
        const blockModelData = modelLoader.getBlockModelData(block, blockState);

        if (!blockModelData.models.length) {
            continue;
        }

        blockModelLookup.set(hashBlockForMap(block), blockModelData);
    }
    return blockModelLookup;
}

function hashBlockForMap(block: Block) {
    return `${block.type}:${JSON.stringify(block.properties)}`;
}

async function computeSchematicMesh(
    loadedSchematic: ReturnType<typeof loadSchematic>,
    blockModelLookup: Map<string, BlockModelData>,
    modelLoader: ReturnType<typeof getModelLoader>,
    scene: Scene,
    worldWidth: number,
    worldHeight: number,
    worldLength: number
) {
    const xTranslation = -worldWidth / 2 + 0.5;
    const yTranslation = -worldHeight / 2 + 0.5;
    const zTranslation = -worldLength / 2 + 0.5;
    scene.blockMaterialDirtyMechanism = true;
    // list of meshes to be simplified before adding to scene
    for (const pos of loadedSchematic) {
        const { x, y, z } = pos;
        const block = loadedSchematic.getBlock(pos);

        if (!block || INVISIBLE_BLOCKS.has(block.type)) {
            continue;
        }

        const modelData = blockModelLookup.get(hashBlockForMap(block));
        if (!modelData) {
            continue;
        }
        let anyVisible = false;
        for (const face of POSSIBLE_FACES) {
            const faceOffset = faceToFacingVector(face);
            const offBlock = loadedSchematic.getBlock({
                x: x + faceOffset[0],
                y: y + faceOffset[1],
                z: z + faceOffset[2],
            });
            if (!offBlock || NON_OCCLUDING_BLOCKS.has(offBlock.type)) {
                anyVisible = true;
                break;
            }
        }

        if (!anyVisible) {
            continue;
        }
        const option = modelLoader.getModelOption(modelData);
        const meshes = await modelLoader.getModel(option, block, scene);
        for (const mesh of meshes) {
            if (!mesh) {
                continue;
            }
            mesh.position.x += xTranslation + x;
            mesh.position.y += yTranslation + y;
            mesh.position.z += zTranslation + z;
            mesh.freezeWorldMatrix();
            scene.addMesh(mesh);
        }
    }
    scene.blockMaterialDirtyMechanism = false;
}

function addGrid(scene: Scene, gridHeight: number) {
    const gridMaterial = new GridMaterial('default', scene);
    gridMaterial.majorUnitFrequency = 10;
    gridMaterial.minorUnitVisibility = 0.4;
    gridMaterial.gridRatio = 1;
    gridMaterial.backFaceCulling = false;
    gridMaterial.mainColor = new Color3(1, 1, 1);
    gridMaterial.lineColor = new Color3(1, 1, 1);
    gridMaterial.opacity = 0.7;
    gridMaterial.zOffset = -1;
    gridMaterial.opacityTexture = new Texture(
        'https://assets.babylonjs.com/environments/backgroundGround.png',
        scene
    );
    const grid = MeshBuilder.CreateGround(
        'ground',
        {
            width: 100,
            height: 100,
        },
        scene
    );
    grid.position.y = gridHeight;
    grid.material = gridMaterial;
}

export async function renderSchematic(
    canvas: HTMLCanvasElement,
    schematic: string,
    {
        corsBypassUrl,
        getClientJarUrl = getClientJarUrlDefault,
        resourcePacks,
        size,
        orbit = true,
        orbitSpeed = 0.02,
        renderArrow = false,
        renderBars = false,
        antialias = false,
        backgroundColor = 0xffffff,
        debug = false,
        disableAutoRender = false,
    }: SchematicRenderOptions
): Promise<SchematicHandles> {
    Mesh.INSTANCEDMESH_SORT_TRANSPARENT = true;
    const blockModelLookup: Map<string, BlockModelData> = new Map();

    const engine = new Engine(canvas, antialias, {
        alpha: backgroundColor !== 'transparent',
        powerPreference: 'high-performance',
    });
    if (size) {
        if (typeof size === 'number') {
            engine.setSize(size, size);
            console.warn(
                'Usage of deprecated `size: number` property in Schematic renderer.'
            );
        } else {
            engine.setSize(size.width, size.height);
        }
    }

    const loadedSchematic = loadSchematic(parseNbt(schematic));
    const {
        width: worldWidth,
        height: worldHeight,
        length: worldLength,
    } = loadedSchematic;
    const cameraOffset = Math.max(worldWidth, worldLength, worldHeight) / 2 + 1;

    const resourceLoader = await getResourceLoader([
        await getClientJarUrl({
            dataVersion: loadedSchematic.dataVersion,
            corsBypassUrl,
        }),
        ...(resourcePacks ?? []),
    ]);
    const modelLoader = getModelLoader(resourceLoader);

    await updateBlockModelLookup(
        blockModelLookup,
        loadedSchematic,
        resourceLoader,
        modelLoader
    );

    const scene = getSceneSetup(engine, backgroundColor);
    // Inspector.Show(scene, {});

    addGrid(scene, -worldHeight / 2);
    const camera = getCameraSetup(scene, cameraOffset, canvas);

    let hasDestroyed = false;

    const render = () => {
        if (hasDestroyed) {
            return;
        }
        scene.render();
    };

    // Inspector.Show(scene, {});

    if (!disableAutoRender) {
        engine.runRenderLoop(render);
    }

    await computeSchematicMesh(
        loadedSchematic,
        blockModelLookup,
        modelLoader,
        scene,
        worldWidth,
        worldHeight,
        worldLength
    );

    if (renderArrow) {
        addArrowToScene(scene, cameraOffset);
    }
    if (renderBars) {
        addBarsToScene(
            scene,
            cameraOffset,
            worldWidth,
            worldHeight,
            worldLength
        );
    }

    scene.createOrUpdateSelectionOctree();
    scene.freezeMaterials();
    if (debug) {
        scene.debugLayer.show();
    }

    if (orbit) {
        scene.registerBeforeRender(() => {
            camera.alpha += orbitSpeed;
        });
    }

    const swapSchematic = async (
        engine: Engine,
        blockModelLookup: Map<string, BlockModelData>,
        scene: Scene,
        newSchematicString: string
    ) => {
        const meshes = scene.meshes;
        const instancedMeshes = meshes.filter(
            mesh => mesh instanceof InstancedMesh
        ) as InstancedMesh[];
        for (const instancedMesh of instancedMeshes) {
            scene.removeMesh(instancedMesh);
            instancedMesh.dispose();
        }
        // THIS !!!!!!! 
        modelLoader.clearCache();
        const newLoadedSchematic = loadSchematic(parseNbt(newSchematicString));

        // get the ground mesh and move it down 
        const groundMesh = meshes.find(mesh => mesh.name === 'ground');
        groundMesh.dispose();
        const { height } = newLoadedSchematic;
        addGrid(scene, -height / 2);

        await updateBlockModelLookup(
            blockModelLookup,
            newLoadedSchematic,
            resourceLoader,
            modelLoader
        );

        await computeSchematicMesh(
            newLoadedSchematic,
            blockModelLookup,
            modelLoader,
            scene,
            newLoadedSchematic.width,
            newLoadedSchematic.height,
            newLoadedSchematic.length
        );

        scene.createOrUpdateSelectionOctree();
        scene.freezeMaterials();
        engine.runRenderLoop(render);
    };

    return {
        swapSchematic: async (newSchematicString: string) => {
            await swapSchematic(
                engine,
                blockModelLookup,
                scene,
                newSchematicString
            );
        },

        resize(size: number): void {
            engine.setSize(size, size);
        },
        setSize(width: number, height: number): void {
            engine.setSize(width, height);
        },
        destroy() {
            engine.dispose();
            hasDestroyed = true;
        },
        render,
        getEngine(): Engine {
            return engine;
        },
    };
}
