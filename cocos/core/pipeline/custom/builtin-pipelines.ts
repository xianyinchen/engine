import { Material } from '../../assets';
import { intersect, Sphere } from '../../geometry';
import { ClearFlagBit, Color, Format, LoadOp, Rect, StoreOp, Viewport } from '../../gfx';
import { macro } from '../../platform';
import { Camera, CSMLevel, DirectionalLight, Light, LightType, ShadowType, SKYBOX_FLAG, SpotLight } from '../../renderer/scene';
import { supportsR32FloatTexture } from '../define';
import { SRGBToLinear } from '../pipeline-funcs';
import { AccessType, AttachmentType, ComputeView, LightInfo, QueueHint, RasterView, ResourceResidency, SceneFlags } from './types';
import { Pipeline, PipelineBuilder } from './pipeline';

export function getRenderArea (camera: Camera, width: number, height: number, light: Light | null = null, level = 0): Rect {
    const out = new Rect();
    const vp = camera.viewport;
    const w = width;
    const h = height;
    out.x = vp.x * w;
    out.y = vp.y * h;
    out.width = vp.width * w;
    out.height = vp.height * h;
    if (light) {
        switch (light.type) {
        case LightType.DIRECTIONAL: {
            const mainLight = light as DirectionalLight;
            if (mainLight.shadowFixedArea || mainLight.csmLevel === CSMLevel.LEVEL_1) {
                out.x = 0;
                out.y = 0;
                out.width = w;
                out.height = h;
            } else {
                out.x = level % 2 * 0.5 * w;
                out.y = (1 - Math.floor(level / 2)) * 0.5 * h;
                out.width = 0.5 * w;
                out.height = 0.5 * h;
            }
            break;
        }
        case LightType.SPOT: {
            out.x = 0;
            out.y = 0;
            out.width = w;
            out.height = h;
            break;
        }
        default:
        }
    }
    return out;
}

class CameraInfo {
    shadowEnabled = false;
    mainLightShadowNames = new Array<string>();
    spotLightShadowNames = new Array<string>();
}

export function buildShadowPasses (cameraName: string, camera: Camera, ppl: Pipeline): CameraInfo {
    const pipeline = ppl;
    const shadowInfo = pipeline.pipelineSceneData.shadows;
    const validPunctualLights = ppl.pipelineSceneData.validPunctualLights;
    const cameraInfo = new CameraInfo();
    const shadows = ppl.pipelineSceneData.shadows;
    if (!shadowInfo.enabled || shadowInfo.type !== ShadowType.ShadowMap) { return cameraInfo; }
    cameraInfo.shadowEnabled = true;
    const _validLights: Light[] = [];
    let n = 0;
    let m = 0;
    for (;n < shadowInfo.maxReceived && m < validPunctualLights.length;) {
        const light = validPunctualLights[m];
        if (light.type === LightType.SPOT) {
            const spotLight = light as SpotLight;
            if (spotLight.shadowEnabled) {
                _validLights.push(light);
                n++;
            }
        }
        m++;
    }
    return cameraInfo;
}

const _cameras: Camera[] = [];

export function getCameraUniqueID (camera: Camera) {
    if (!_cameras.includes(camera)) {
        _cameras.push(camera);
    }
    return _cameras.indexOf(camera);
}

export function getLoadOpOfClearFlag (clearFlag: ClearFlagBit, attachment: AttachmentType): LoadOp {
    let loadOp = LoadOp.CLEAR;
    if (!(clearFlag & ClearFlagBit.COLOR)
        && attachment === AttachmentType.RENDER_TARGET) {
        if (clearFlag & SKYBOX_FLAG) {
            loadOp = LoadOp.DISCARD;
        } else {
            loadOp = LoadOp.LOAD;
        }
    }
    if ((clearFlag & ClearFlagBit.DEPTH_STENCIL) !== ClearFlagBit.DEPTH_STENCIL
        && attachment === AttachmentType.DEPTH_STENCIL) {
        if (!(clearFlag & ClearFlagBit.DEPTH)) loadOp = LoadOp.LOAD;
        if (!(clearFlag & ClearFlagBit.STENCIL)) loadOp = LoadOp.LOAD;
    }
    return loadOp;
}

export class ForwardPipelineBuilder extends PipelineBuilder {
    public setup (cameras: Camera[], ppl: Pipeline): void {
        for (let i = 0; i < cameras.length; i++) {
            const camera = cameras[i];
            if (camera.scene === null) {
                continue;
            }
            const cameraID = getCameraUniqueID(camera);
            const cameraName = `Camera${cameraID}`;
            const cameraInfo = buildShadowPasses(cameraName, camera, ppl);
            const width = camera.window.width;
            const height = camera.window.height;

            const forwardPassRTName = `dsForwardPassColor${cameraName}`;
            const forwardPassDSName = `dsForwardPassDS${cameraName}`;
            if (!ppl.containsResource(forwardPassRTName)) {
                ppl.addRenderTexture(forwardPassRTName, Format.RGBA8, width, height, camera.window);
                ppl.addDepthStencil(forwardPassDSName, Format.DEPTH_STENCIL, width, height, ResourceResidency.MANAGED);
            }
            const forwardPass = ppl.addRasterPass(width, height, 'default', `CameraForwardPass${cameraID}`);
            for (const dirShadowName of cameraInfo.mainLightShadowNames) {
                if (ppl.containsResource(dirShadowName)) {
                    const computeView = new ComputeView();
                    forwardPass.addComputeView(dirShadowName, computeView);
                }
            }
            for (const spotShadowName of cameraInfo.spotLightShadowNames) {
                if (ppl.containsResource(spotShadowName)) {
                    const computeView = new ComputeView();
                    forwardPass.addComputeView(spotShadowName, computeView);
                }
            }
            const passView = new RasterView('_',
                AccessType.WRITE, AttachmentType.RENDER_TARGET,
                getLoadOpOfClearFlag(camera.clearFlag, AttachmentType.RENDER_TARGET),
                StoreOp.STORE,
                camera.clearFlag,
                new Color(camera.clearColor.x, camera.clearColor.y, camera.clearColor.z, camera.clearColor.w));
            const passDSView = new RasterView('_',
                AccessType.WRITE, AttachmentType.DEPTH_STENCIL,
                getLoadOpOfClearFlag(camera.clearFlag, AttachmentType.DEPTH_STENCIL),
                StoreOp.STORE,
                camera.clearFlag,
                new Color(camera.clearDepth, camera.clearStencil, 0, 0));
            forwardPass.addRasterView(forwardPassRTName, passView);
            forwardPass.addRasterView(forwardPassDSName, passDSView);
            forwardPass
                .addQueue(QueueHint.RENDER_OPAQUE)
                .addSceneOfCamera(camera, new LightInfo(),
                    SceneFlags.OPAQUE_OBJECT | SceneFlags.PLANAR_SHADOW | SceneFlags.CUTOUT_OBJECT
                    | SceneFlags.PLANAR_SHADOW | SceneFlags.DEFAULT_LIGHTING);
            forwardPass
                .addQueue(QueueHint.RENDER_TRANSPARENT)
                .addSceneOfCamera(camera, new LightInfo(), SceneFlags.TRANSPARENT_OBJECT | SceneFlags.UI | SceneFlags.GEOMETRY | SceneFlags.PROFILER);
        }
    }
}

// Anti-aliasing type, other types will be gradually added in the future
export enum AntiAliasing {
    NONE,
    FXAA,
}

export class DeferredPipelineBuilder extends PipelineBuilder {
    public setup (cameras: Camera[], ppl: Pipeline): void {
        
    }
}
