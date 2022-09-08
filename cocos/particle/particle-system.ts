/*
 Copyright (c) 2020 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated engine source code (the "Software"), a limited,
 worldwide, royalty-free, non-assignable, revocable and non-exclusive license
 to use Cocos Creator solely to develop games on your target platforms. You shall
 not use Cocos Creator software for developing other software or tools that's
 used for developing games. You are not granted to publish, distribute,
 sublicense, and/or sell copies of Cocos Creator.

 The software or tools in this License Agreement are licensed, not sold.
 Xiamen Yaji Software Co., Ltd. reserves all rights not expressly granted to you.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

// eslint-disable-next-line max-len
import { ccclass, help, executeInEditMode, executionOrder, menu, tooltip, displayOrder, type, range, displayName, formerlySerializedAs, override, radian, serializable, visible } from 'cc.decorator';
import { CCClass } from '../core/data';
import { EDITOR } from 'internal:constants';
import { Renderer } from '../core/components/renderer';
import { ModelRenderer } from '../core/components/model-renderer';
import { Material } from '../core/assets/material';
import { Mat4, pseudoRandom, Quat, randomRangeInt, Vec2, Vec3 } from '../core/math';
import { INT_MAX } from '../core/math/bits';
import { scene } from '../core/renderer';
import ColorOverLifetimeModule from './animator/color-overtime';
import CurveRange, { Mode } from './animator/curve-range';
import ForceOvertimeModule from './animator/force-overtime';
import GradientRange from './animator/gradient-range';
import LimitVelocityOvertimeModule from './animator/limit-velocity-overtime';
import RotationOvertimeModule from './animator/rotation-overtime';
import SizeOvertimeModule from './animator/size-overtime';
import TextureAnimationModule from './animator/texture-animation';
import VelocityOvertimeModule from './animator/velocity-overtime';
import Burst from './burst';
import ShapeModule from './emitter/shape-module';
import { CullingMode, Space } from './enum';
import { particleEmitZAxis } from './particle-general-function';
import ParticleSystemRenderer from './renderer/particle-system-renderer-data';
import TrailModule from './renderer/trail';
import { IParticleSystemRenderer } from './renderer/particle-system-renderer-base';
import { PARTICLE_MODULE_PROPERTY } from './particle';
import { legacyCC } from '../core/global-exports';
import { TransformBit } from '../core/scene-graph/node-enum';
import { AABB, intersect } from '../core/geometry';
import { Camera } from '../core/renderer/scene';
import { ParticleCuller } from './particle-culler';
import { NoiseModule } from './animator/noise-module';
import { CCBoolean, CCFloat } from '../core';
import { CCInteger, setClassAttr } from '../core/data/utils/attribute';

const _world_mat = new Mat4();
const _world_rol = new Quat();

const superMaterials = Object.getOwnPropertyDescriptor(Renderer.prototype, 'sharedMaterials')!;

@ccclass('cc.ParticleSystem')
@help('i18n:cc.ParticleSystem')
@menu('Effects/ParticleSystem')
@executionOrder(99)
@executeInEditMode
export class ParticleSystem extends ModelRenderer {
    /**
     * @zh 粒子系统能生成的最大粒子数量。
     */
    public get capacity () {
        return this._capacity;
    }

    public set capacity (val) {
        this._capacity = Math.floor(val > 0 ? val : 0);
        // @ts-expect-error private property access
        if (this.processor && this.processor._model) {
            // @ts-expect-error private property access
            this.processor._model.setCapacity(this._capacity);
        }
    }

    /**
     * @zh 粒子初始颜色。
     */
    public startColor = new GradientRange();
    public scaleSpace = Space.Local;
    public startSize3D = false;

    /**
     * @zh 粒子初始大小。
     */
    public startSizeX = new CurveRange();

    /**
     * @zh 粒子初始大小。
     */
    public startSizeY = new CurveRange();

    /**
     * @zh 粒子初始大小。
     */
    public startSizeZ = new CurveRange();

    /**
     * @zh 粒子初始速度。
     */
    public startSpeed = new CurveRange();
    public startRotation3D = false;

    /**
     * @zh 粒子初始旋转角度。
     */
    public startRotationX = new CurveRange();

    /**
     * @zh 粒子初始旋转角度。
     */
    public startRotationY = new CurveRange();

    /**
     * @zh 粒子初始旋转角度。
     */
    public startRotationZ = new CurveRange();

    /**
     * @zh 粒子系统开始运行后，延迟粒子发射的时间。
     */
    public startDelay = new CurveRange();

    /**
     * @zh 粒子生命周期。
     */
    public startLifetime = new CurveRange();

    /**
     * @zh 粒子系统运行时间。
     */
    public duration = 5.0;

    /**
     * @zh 粒子系统是否循环播放。
     */
    public loop = true;

    /**
     * @zh 选中之后，粒子系统会以已播放完一轮之后的状态开始播放（仅当循环播放启用时有效）。
     */
    get prewarm () {
        return this._prewarm;
    }

    set prewarm (val) {
        if (val === true && this.loop === false) {
            // console.warn('prewarm only works if loop is also enabled.');
        }
        this._prewarm = val;
    }

    /**
     * @zh 选择粒子系统所在的坐标系[[Space]]。<br>
     */
    get simulationSpace () {
        return this._simulationSpace;
    }

    set simulationSpace (val) {
        if (val !== this._simulationSpace) {
            this._simulationSpace = val;
            if (this.processor) {
                this.processor.updateMaterialParams();
                this.processor.updateTrailMaterial();
            }
        }
    }

    /**
     * @zh 控制整个粒子系统的更新速度。
     */
    public simulationSpeed = 1.0;

    /**
     * @zh 粒子系统加载后是否自动开始播放。
     */
    public playOnAwake = true;

    /**
     * @zh 粒子受重力影响的重力系数。
     */
    public gravityModifier = new CurveRange();

    // emission module
    /**
     * @zh 每秒发射的粒子数。
     */
    public rateOverTime = new CurveRange();

    /**
     * @zh 每移动单位距离发射的粒子数。
     */
    public rateOverDistance = new CurveRange();

    /**
     * @zh 设定在指定时间发射指定数量的粒子的 burst 的数量。
     */
    public bursts: Burst[] = [];

    /**
     * @en Enable particle culling switch. Open it to enable particle culling. If enabled will generate emitter bounding box and emitters outside the frustum will be culled.
     * @zh 粒子剔除开关，如果打开将会生成一个发射器包围盒，包围盒在相机外发射器将被剔除。
     */
    set renderCulling (value: boolean) {
        this._renderCulling = value;
        if (value) {
            if (!this._boundingBox) {
                this._boundingBox = new AABB();
                this._calculateBounding(false);
            }
        }
    }

    get renderCulling () {
        return this._renderCulling;
    }

    private _renderCulling = false;

    /**
     * @en Particle culling mode option. Includes pause, pause and catchup, always simulate.
     * @zh 粒子剔除模式选择。包括暂停模拟，暂停以后快进继续以及不间断模拟。
     */
    get cullingMode () {
        return this._cullingMode;
    }

    set cullingMode (value: number) {
        this._cullingMode = value;
    }

    _cullingMode = CullingMode.Pause;

    public static CullingMode = CullingMode;

    /**
     * @en Particle bounding box half width.
     * @zh 粒子包围盒半宽。
     */
    get aabbHalfX () {
        const res = this.getBoundingX();
        if (res) {
            return res;
        } else {
            return 0;
        }
    }

    set aabbHalfX (value: number) {
        this.setBoundingX(value);
    }

    private _aabbHalfX = 0;

    /**
     * @en Particle bounding box half height.
     * @zh 粒子包围盒半高。
     */
    get aabbHalfY () {
        const res = this.getBoundingY();
        if (res) {
            return res;
        } else {
            return 0;
        }
    }

    set aabbHalfY (value: number) {
        this.setBoundingY(value);
    }

    private _aabbHalfY = 0;

    /**
     * @en Particle bounding box half depth.
     * @zh 粒子包围盒半深。
     */
    get aabbHalfZ () {
        const res = this.getBoundingZ();
        if (res) {
            return res;
        } else {
            return 0;
        }
    }

    set aabbHalfZ (value: number) {
        this.setBoundingZ(value);
    }

    private _aabbHalfZ = 0;

    /**
     * @en Culling module data before serialize.
     * @zh 序列化之前剔除不需要的模块数据。
     */
    get dataCulling () {
        return this._dataCulling;
    }

    set dataCulling (value: boolean) {
        this._dataCulling = value;
    }

    private _dataCulling = false;

    get sharedMaterials () {
        // if we don't create an array copy, the editor will modify the original array directly.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return superMaterials.get!.call(this);
    }

    set sharedMaterials (val) {
        // @ts-expect-error private property access
        superMaterials.set.call(this, val);
    }

    // color over lifetime module
    _colorOverLifetimeModule: ColorOverLifetimeModule | null = null;
    /**
     * @zh 颜色控制模块。
     */
    public get colorOverLifetimeModule () {
        if (EDITOR && !legacyCC.GAME_VIEW) {
            if (!this._colorOverLifetimeModule) {
                this._colorOverLifetimeModule = new ColorOverLifetimeModule();
                this._colorOverLifetimeModule.bindTarget(this.processor);
            }
        }
        return this._colorOverLifetimeModule;
    }

    public set colorOverLifetimeModule (val) {
        if (!val) return;
        this._colorOverLifetimeModule = val;
    }

    // shape module
    _shapeModule: ShapeModule | null = null;
    /**
     * @zh 粒子发射器模块。
     */
    public get shapeModule () {
        if (EDITOR && !legacyCC.GAME_VIEW) {
            if (!this._shapeModule) {
                this._shapeModule = new ShapeModule();
                this._shapeModule.onInit(this);
            }
        }
        return this._shapeModule;
    }

    public set shapeModule (val) {
        if (!val) return;
        this._shapeModule = val;
    }

    // size over lifetime module
    _sizeOvertimeModule: SizeOvertimeModule | null = null;
    /**
     * @zh 粒子大小模块。
     */
    public get sizeOvertimeModule () {
        if (EDITOR && !legacyCC.GAME_VIEW) {
            if (!this._sizeOvertimeModule) {
                this._sizeOvertimeModule = new SizeOvertimeModule();
                this._sizeOvertimeModule.bindTarget(this.processor);
            }
        }
        return this._sizeOvertimeModule;
    }

    public set sizeOvertimeModule (val) {
        if (!val) return;
        this._sizeOvertimeModule = val;
    }

    // velocity overtime module
    _velocityOvertimeModule: VelocityOvertimeModule | null = null;
    /**
     * @zh 粒子速度模块。
     */
    public get velocityOvertimeModule () {
        if (EDITOR && !legacyCC.GAME_VIEW) {
            if (!this._velocityOvertimeModule) {
                this._velocityOvertimeModule = new VelocityOvertimeModule();
                this._velocityOvertimeModule.bindTarget(this.processor);
            }
        }
        return this._velocityOvertimeModule;
    }

    public set velocityOvertimeModule (val) {
        if (!val) return;
        this._velocityOvertimeModule = val;
    }

    // force overTime module
    _forceOvertimeModule: ForceOvertimeModule | null = null;
    /**
     * @zh 粒子加速度模块。
     */
    public get forceOvertimeModule () {
        if (EDITOR && !legacyCC.GAME_VIEW) {
            if (!this._forceOvertimeModule) {
                this._forceOvertimeModule = new ForceOvertimeModule();
                this._forceOvertimeModule.bindTarget(this.processor);
            }
        }
        return this._forceOvertimeModule;
    }

    public set forceOvertimeModule (val) {
        if (!val) return;
        this._forceOvertimeModule = val;
    }

    // limit velocity overtime module
    _limitVelocityOvertimeModule: LimitVelocityOvertimeModule | null = null;

    /**
     * @zh 粒子限制速度模块（只支持 CPU 粒子）。
     */
    public get limitVelocityOvertimeModule () {
        if (EDITOR && !legacyCC.GAME_VIEW) {
            if (!this._limitVelocityOvertimeModule) {
                this._limitVelocityOvertimeModule = new LimitVelocityOvertimeModule();
                this._limitVelocityOvertimeModule.bindTarget(this.processor);
            }
        }
        return this._limitVelocityOvertimeModule;
    }

    public set limitVelocityOvertimeModule (val) {
        if (!val) return;
        this._limitVelocityOvertimeModule = val;
    }

    // rotation overtime module
    _rotationOvertimeModule: RotationOvertimeModule | null = null;
    /**
     * @zh 粒子旋转模块。
     */
    public get rotationOvertimeModule () {
        if (EDITOR && !legacyCC.GAME_VIEW) {
            if (!this._rotationOvertimeModule) {
                this._rotationOvertimeModule = new RotationOvertimeModule();
                this._rotationOvertimeModule.bindTarget(this.processor);
            }
        }
        return this._rotationOvertimeModule;
    }

    public set rotationOvertimeModule (val) {
        if (!val) return;
        this._rotationOvertimeModule = val;
    }

    // texture animation module
    _textureAnimationModule: TextureAnimationModule | null = null;
    /**
     * @zh 贴图动画模块。
     */
    public get textureAnimationModule () {
        if (EDITOR && !legacyCC.GAME_VIEW) {
            if (!this._textureAnimationModule) {
                this._textureAnimationModule = new TextureAnimationModule();
                this._textureAnimationModule.bindTarget(this.processor);
            }
        }
        return this._textureAnimationModule;
    }

    public set textureAnimationModule (val) {
        if (!val) return;
        this._textureAnimationModule = val;
    }

    // noise module
    private _noiseModule: NoiseModule | null = null;

    public get noiseModule () {
        if (EDITOR) {
            if (!this._noiseModule) {
                this._noiseModule = new NoiseModule();
                this._noiseModule.bindTarget(this.processor);
            }
        }
        return this._noiseModule;
    }

    public set noiseModule (val) {
        if (!val) return;
        this._noiseModule = val;
    }

    // trail module
    _trailModule: TrailModule | null = null;
    /**
     * @zh 粒子轨迹模块。
     */
    public get trailModule () {
        if (EDITOR && !legacyCC.GAME_VIEW) {
            if (!this._trailModule) {
                this._trailModule = new TrailModule();
                this._trailModule.onInit(this);
                this._trailModule.onEnable();
            }
        }
        return this._trailModule;
    }

    public set trailModule (val) {
        if (!val) return;
        this._trailModule = val;
    }

    // particle system renderer
    public renderer: ParticleSystemRenderer = new ParticleSystemRenderer();

    /**
     * @ignore
     */
    private _isPlaying: boolean;
    private _isPaused: boolean;
    private _isStopped: boolean;
    private _isEmitting: boolean;
    private _needRefresh: boolean;

    private _time: number;  // playback position in seconds.
    private _emitRateTimeCounter: number;
    private _emitRateDistanceCounter: number;
    private _oldWPos: Vec3;
    private _curWPos: Vec3;

    private _boundingBox: AABB | null;
    private _culler: ParticleCuller | null;
    private _oldPos: Vec3 | null;
    private _curPos: Vec3 | null;
    private _isCulled: boolean;
    private _isSimulating: boolean;

    private _customData1: Vec2;
    private _customData2: Vec2;

    private _subEmitters: any[]; // array of { emitter: ParticleSystem, type: 'birth', 'collision' or 'death'}

    private _needAttach: boolean;

    private _prewarm = false;
    private _capacity = 100;
    private _simulationSpace = Space.Local;

    public processor: IParticleSystemRenderer = null!;

    constructor () {
        super();

        this.rateOverTime.constant = 10;
        this.startLifetime.constant = 5;
        this.startSizeX.constant = 1;
        this.startSpeed.constant = 5;

        // internal status
        this._isPlaying = false;
        this._isPaused = false;
        this._isStopped = true;
        this._isEmitting = false;
        this._needRefresh = true;
        this._needAttach = false;

        this._time = 0.0;  // playback position in seconds.
        this._emitRateTimeCounter = 0.0;
        this._emitRateDistanceCounter = 0.0;
        this._oldWPos = new Vec3();
        this._curWPos = new Vec3();

        this._boundingBox = null;
        this._culler = null;
        this._oldPos = null;
        this._curPos = null;
        this._isCulled = false;
        this._isSimulating = true;

        this._customData1 = new Vec2();
        this._customData2 = new Vec2();

        this._subEmitters = []; // array of { emitter: ParticleSystem, type: 'birth', 'collision' or 'death'}
    }

    public onFocusInEditor () {
        this.renderer.create(this);
    }

    public onLoad () {
        // HACK, TODO
        this.renderer.onInit(this);
        if (this._shapeModule) this._shapeModule.onInit(this);
        if (this._trailModule && !this.renderer.useGPU) {
            this._trailModule.onInit(this);
        }
        this.bindModule();
        this._resetPosition();

        // this._system.add(this);
    }

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _onMaterialModified (index: number, material: Material) {
        if (this.processor !== null) {
            this.processor.onMaterialModified(index, material);
        }
    }

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _onRebuildPSO (index: number, material: Material) {
        this.processor.onRebuildPSO(index, material);
    }

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _collectModels (): scene.Model[] {
        this._models.length = 0;
        this._models.push((this.processor as any)._model);
        if (this._trailModule && this._trailModule.enable && (this._trailModule as any)._trailModel) {
            this._models.push((this._trailModule as any)._trailModel);
        }
        return this._models;
    }

    protected _attachToScene () {
        this.processor.attachToScene();
        if (this._trailModule && this._trailModule.enable) {
            this._trailModule._attachToScene();
        }
    }

    protected _detachFromScene () {
        this.processor.detachFromScene();
        if (this._trailModule && this._trailModule.enable) {
            this._trailModule._detachFromScene();
        }
        if (this._boundingBox) {
            this._boundingBox = null;
        }
        if (this._culler) {
            this._culler.clear();
            this._culler.destroy();
            this._culler = null;
        }
    }

    public bindModule () {
        if (this._colorOverLifetimeModule) this._colorOverLifetimeModule.bindTarget(this.processor);
        if (this._sizeOvertimeModule) this._sizeOvertimeModule.bindTarget(this.processor);
        if (this._rotationOvertimeModule) this._rotationOvertimeModule.bindTarget(this.processor);
        if (this._forceOvertimeModule) this._forceOvertimeModule.bindTarget(this.processor);
        if (this._limitVelocityOvertimeModule) this._limitVelocityOvertimeModule.bindTarget(this.processor);
        if (this._velocityOvertimeModule) this._velocityOvertimeModule.bindTarget(this.processor);
        if (this._textureAnimationModule) this._textureAnimationModule.bindTarget(this.processor);
        if (this._noiseModule) this._noiseModule.bindTarget(this.processor);
    }

    // TODO: Fast forward current particle system by simulating particles over given period of time, then pause it.
    // simulate(time, withChildren, restart, fixedTimeStep) {

    // }

    /**
     * @en play particle system
     * @zh 播放粒子效果。
     */
    public play () {
        if (this._isPaused) {
            this._isPaused = false;
        }
        if (this._isStopped) {
            this._isStopped = false;
        }

        this._isPlaying = true;
        this._isEmitting = true;

        this._resetPosition();

        // prewarm
        if (this._prewarm) {
            this._prewarmSystem();
        }

        if (this._trailModule) {
            this._trailModule.play();
        }

        if (this.processor) {
            const model = this.processor.getModel();
            if (model) {
                model.enabled = this.enabledInHierarchy;
            }
        }
    }

    /**
     * @en pause particle system
     * @zh 暂停播放粒子效果。
     */
    public pause () {
        if (this._isStopped) {
            console.warn('pause(): particle system is already stopped.');
            return;
        }
        if (this._isPlaying) {
            this._isPlaying = false;
        }

        this._isPaused = true;
    }

    /**
     * @zh 停止发射粒子。
     * @en Stop emitting particles.
     */
    public stopEmitting () {
        this._isEmitting = false;
    }

    /**
     * @en stop particle system
     * @zh 停止播放粒子。
     */
    public stop () {
        if (this._isPlaying || this._isPaused) {
            this.clear();
        }
        if (this._isPlaying) {
            this._isPlaying = false;
        }
        if (this._isPaused) {
            this._isPaused = false;
        }
        if (this._isEmitting) {
            this._isEmitting = false;
        }

        this._time = 0.0;
        this._emitRateTimeCounter = 0.0;
        this._emitRateDistanceCounter = 0.0;

        this._isStopped = true;

        // if stop emit modify the refresh flag to true
        this._needRefresh = true;

        for (const burst of this.bursts) {
            burst.reset();
        }
    }

    /**
     * @en remove all particles from current particle system.
     * @zh 将所有粒子从粒子系统中清除。
     */
    public clear () {
        if (this.enabledInHierarchy) {
            this.processor.clear();
            if (this._trailModule) this._trailModule.clear();
        }
        this._calculateBounding(false);
    }

    /**
     * @zh 获取当前粒子数量
     */
    public getParticleCount () {
        return this.processor.getParticleCount();
    }

    /**
     * @ignore
     */
    public setCustomData1 (x, y) {
        Vec2.set(this._customData1, x, y);
    }

    public setCustomData2 (x, y) {
        Vec2.set(this._customData2, x, y);
    }

    protected onDestroy () {
        this.stop();
        if (this.processor.getModel()?.scene) {
            this.processor.detachFromScene();
            if (this._trailModule && this._trailModule.enable) {
                this._trailModule._detachFromScene();
            }
        }
        legacyCC.director.off(legacyCC.Director.EVENT_BEFORE_COMMIT, this.beforeRender, this);
        // this._system.remove(this);
        this.processor.onDestroy();
        if (this._trailModule) this._trailModule.destroy();
        if (this._culler) {
            this._culler.clear();
            this._culler.destroy();
            this._culler = null;
        }
    }

    protected onEnable () {
        super.onEnable();
        legacyCC.director.on(legacyCC.Director.EVENT_BEFORE_COMMIT, this.beforeRender, this);
        if (this.playOnAwake && (!EDITOR || legacyCC.GAME_VIEW)) {
            this.play();
        }
        this.processor.onEnable();
        if (this._trailModule) this._trailModule.onEnable();
    }
    protected onDisable () {
        legacyCC.director.off(legacyCC.Director.EVENT_BEFORE_COMMIT, this.beforeRender, this);
        this.processor.onDisable();
        if (this._trailModule) this._trailModule.onDisable();
        if (this._boundingBox) {
            this._boundingBox = null;
        }
        if (this._culler) {
            this._culler.clear();
            this._culler.destroy();
            this._culler = null;
        }
    }

    private _calculateBounding (forceRefresh: boolean) {
        if (this._boundingBox) {
            if (!this._culler) {
                this._culler = new ParticleCuller(this);
            }
            this._culler.calculatePositions();
            AABB.fromPoints(this._boundingBox, this._culler.minPos, this._culler.maxPos);
            if (forceRefresh) {
                this.aabbHalfX = this._boundingBox.halfExtents.x;
                this.aabbHalfY = this._boundingBox.halfExtents.y;
                this.aabbHalfZ = this._boundingBox.halfExtents.z;
            } else {
                if (this.aabbHalfX) {
                    this.setBoundingX(this.aabbHalfX);
                } else {
                    this.aabbHalfX = this._boundingBox.halfExtents.x;
                }

                if (this.aabbHalfY) {
                    this.setBoundingY(this.aabbHalfY);
                } else {
                    this.aabbHalfY = this._boundingBox.halfExtents.y;
                }

                if (this.aabbHalfZ) {
                    this.setBoundingZ(this.aabbHalfZ);
                } else {
                    this.aabbHalfZ = this._boundingBox.halfExtents.z;
                }
            }
            this._culler.clear();
        }
    }

    protected update (dt: number) {
        const scaledDeltaTime = dt * this.simulationSpeed;

        if (!this.renderCulling) {
            if (this._boundingBox) {
                this._boundingBox = null;
            }
            if (this._culler) {
                this._culler.clear();
                this._culler.destroy();
                this._culler = null;
            }
            this._isSimulating = true;
        } else {
            if (!this._boundingBox) {
                this._boundingBox = new AABB();
                this._calculateBounding(false);
            }

            if (!this._curPos) {
                this._curPos = new Vec3();
            }
            this.node.getWorldPosition(this._curPos);
            if (!this._oldPos) {
                this._oldPos = new Vec3();
                this._oldPos.set(this._curPos);
            }
            if (!this._curPos.equals(this._oldPos) && this._boundingBox && this._culler) {
                const dx = this._curPos.x - this._oldPos.x;
                const dy = this._curPos.y - this._oldPos.y;
                const dz = this._curPos.z - this._oldPos.z;
                const center = this._boundingBox.center;
                center.x += dx;
                center.y += dy;
                center.z += dz;
                this._culler.setBoundingBoxCenter(center.x, center.y, center.z);
                this._oldPos.set(this._curPos);
            }

            const cameraLst: Camera[]|undefined = this.node.scene.renderScene?.cameras;
            let culled = true;
            if (cameraLst !== undefined && this._boundingBox) {
                for (let i = 0; i < cameraLst.length; ++i) {
                    const camera:Camera = cameraLst[i];
                    const visibility = camera.visibility;
                    if ((visibility & this.node.layer) === this.node.layer) {
                        if (EDITOR && !legacyCC.GAME_VIEW) {
                            if (camera.name === 'Editor Camera' && intersect.aabbFrustum(this._boundingBox, camera.frustum)) {
                                culled = false;
                                break;
                            }
                        } else if (intersect.aabbFrustum(this._boundingBox, camera.frustum)) {
                            culled = false;
                            break;
                        }
                    }
                }
            }
            if (culled) {
                if (this._cullingMode !== CullingMode.AlwaysSimulate) {
                    this._isSimulating = false;
                }
                if (!this._isCulled) {
                    this.processor.detachFromScene();
                    this._isCulled = true;
                }
                if (this._trailModule && this._trailModule.enable) {
                    this._trailModule._detachFromScene();
                }
                if (this._cullingMode === CullingMode.PauseAndCatchup) {
                    this._time += scaledDeltaTime;
                }
                if (this._cullingMode !== CullingMode.AlwaysSimulate) {
                    return;
                }
            } else {
                if (this._isCulled) {
                    this._attachToScene();
                    this._isCulled = false;
                }
                if (!this._isSimulating) {
                    this._isSimulating = true;
                }
            }

            if (!this._isSimulating) {
                return;
            }
        }

        if (this._isPlaying) {
            this._time += scaledDeltaTime;

            // Execute emission
            this._emit(scaledDeltaTime);

            // simulation, update particles.
            if (this.processor.updateParticles(scaledDeltaTime) === 0 && !this._isEmitting) {
                this.stop();
            }
        } else {
            const mat: Material | null = this.getMaterialInstance(0) || this.processor.getDefaultMaterial();
            const pass = mat!.passes[0];
            this.processor.updateRotation(pass);
            this.processor.updateScale(pass);
        }
        // update render data
        this.processor.updateRenderData();

        // update trail
        if (this._trailModule && this._trailModule.enable) {
            this._trailModule.updateRenderData();
        }

        if (this._needAttach) { // Check whether this particle model should be reattached
            if (this.getParticleCount() > 0) {
                if (!this._isCulled) {
                    if (!this.processor.getModel()?.scene) {
                        this.processor.attachToScene();
                    }
                    if (this._trailModule && this._trailModule.enable) {
                        if (!this._trailModule.getModel()?.scene) {
                            this._trailModule._attachToScene();
                        }
                    }
                    this._needAttach = false;
                }
            }
        }
    }

    protected beforeRender () {
        if (!this._isPlaying) return;
        this.processor.beforeRender();
        if (this._trailModule && this._trailModule.enable) {
            this._trailModule.beforeRender();
        }

        if (this.getParticleCount() <= 0) {
            if (this.processor.getModel()?.scene) {
                this.processor.detachFromScene();
                if (this._trailModule && this._trailModule.enable) {
                    this._trailModule._detachFromScene();
                }
                this._needAttach = false;
            }
        } else if (!this.processor.getModel()?.scene) {
            this._needAttach = true;
        }
    }

    protected _onVisibilityChange (val) {
        // @ts-expect-error private property access
        if (this.processor._model) {
            // @ts-expect-error private property access
            this.processor._model.visFlags = val;
        }
    }

    private emit (count: number, dt: number) {
        const loopDelta = (this._time % this.duration) / this.duration; // loop delta value

        // refresh particle node position to update emit position
        if (this._needRefresh) {
            // this.node.setPosition(this.node.getPosition());
            this.node.invalidateChildren(TransformBit.POSITION);

            this._needRefresh = false;
        }

        if (this._simulationSpace === Space.World) {
            this.node.getWorldMatrix(_world_mat);
            this.node.getWorldRotation(_world_rol);
        }

        for (let i = 0; i < count; ++i) {
            const particle = this.processor.getFreeParticle();
            if (particle === null) {
                return;
            }
            particle.particleSystem = this;
            particle.reset();

            const rand = pseudoRandom(randomRangeInt(0, INT_MAX));

            if (this._shapeModule && this._shapeModule.enable) {
                this._shapeModule.emit(particle);
            } else {
                Vec3.set(particle.position, 0, 0, 0);
                Vec3.copy(particle.velocity, particleEmitZAxis);
            }

            if (this._textureAnimationModule && this._textureAnimationModule.enable) {
                this._textureAnimationModule.init(particle);
            }

            const curveStartSpeed = this.startSpeed.evaluate(loopDelta, rand)!;
            Vec3.multiplyScalar(particle.velocity, particle.velocity, curveStartSpeed);

            if (this._simulationSpace === Space.World) {
                Vec3.transformMat4(particle.position, particle.position, _world_mat);
                Vec3.transformQuat(particle.velocity, particle.velocity, _world_rol);
            }

            Vec3.copy(particle.ultimateVelocity, particle.velocity);
            // apply startRotation.
            if (this.startRotation3D) {
                // eslint-disable-next-line max-len
                particle.startEuler.set(this.startRotationX.evaluate(loopDelta, rand), this.startRotationY.evaluate(loopDelta, rand), this.startRotationZ.evaluate(loopDelta, rand));
            } else {
                particle.startEuler.set(0, 0, this.startRotationZ.evaluate(loopDelta, rand));
            }
            particle.rotation.set(particle.startEuler);

            // apply startSize.
            if (this.startSize3D) {
                Vec3.set(particle.startSize, this.startSizeX.evaluate(loopDelta, rand)!,
                    this.startSizeY.evaluate(loopDelta, rand)!,
                    this.startSizeZ.evaluate(loopDelta, rand)!);
            } else {
                Vec3.set(particle.startSize, this.startSizeX.evaluate(loopDelta, rand)!, 1, 1);
                particle.startSize.y = particle.startSize.x;
            }
            Vec3.copy(particle.size, particle.startSize);

            // apply startColor.
            particle.startColor.set(this.startColor.evaluate(loopDelta, rand));
            particle.color.set(particle.startColor);

            // apply startLifetime.
            particle.startLifetime = this.startLifetime.evaluate(loopDelta, rand)! + dt;
            particle.remainingLifetime = particle.startLifetime;

            particle.randomSeed = randomRangeInt(0, 233280);
            particle.loopCount++;

            this.processor.setNewParticle(particle);
        } // end of particles forLoop.
    }

    // initialize particle system as though it had already completed a full cycle.
    private _prewarmSystem () {
        this.startDelay.mode = Mode.Constant; // clear startDelay.
        this.startDelay.constant = 0;
        const dt = 1.0; // should use varying value?
        const cnt = this.duration / dt;

        for (let i = 0; i < cnt; ++i) {
            this._time += dt;
            this._emit(dt);
            this.processor.updateParticles(dt);
        }
    }

    // internal function
    private _emit (dt) {
        // emit particles.
        const startDelay = this.startDelay.evaluate(0, 1)!;
        if (this._time > startDelay) {
            if (this._time > (this.duration + startDelay)) {
                // this._time = startDelay; // delay will not be applied from the second loop.(Unity)
                // this._emitRateTimeCounter = 0.0;
                // this._emitRateDistanceCounter = 0.0;
                if (!this.loop) {
                    this._isEmitting = false;
                }
            }

            if (!this._isEmitting) return;

            // emit by rateOverTime
            this._emitRateTimeCounter += this.rateOverTime.evaluate(this._time / this.duration, 1)! * dt;
            if (this._emitRateTimeCounter > 1) {
                const emitNum = Math.floor(this._emitRateTimeCounter);
                this._emitRateTimeCounter -= emitNum;
                this.emit(emitNum, dt);
            }

            // emit by rateOverDistance
            this.node.getWorldPosition(this._curWPos);
            const distance = Vec3.distance(this._curWPos, this._oldWPos);
            Vec3.copy(this._oldWPos, this._curWPos);
            this._emitRateDistanceCounter += distance * this.rateOverDistance.evaluate(this._time / this.duration, 1)!;

            if (this._emitRateDistanceCounter > 1) {
                const emitNum = Math.floor(this._emitRateDistanceCounter);
                this._emitRateDistanceCounter -= emitNum;
                this.emit(emitNum, dt);
            }

            // bursts
            for (const burst of this.bursts) {
                burst.update(this, dt);
            }
        }
    }

    private _resetPosition () {
        this.node.getWorldPosition(this._oldWPos);
        Vec3.copy(this._curWPos, this._oldWPos);
    }

    private addSubEmitter (subEmitter) {
        this._subEmitters.push(subEmitter);
    }

    private removeSubEmitter (idx) {
        this._subEmitters.splice(this._subEmitters.indexOf(idx), 1);
    }

    private addBurst (burst) {
        this.bursts.push(burst);
    }

    private removeBurst (idx) {
        this.bursts.splice(this.bursts.indexOf(idx), 1);
    }

    private getBoundingX () {
        return this._aabbHalfX;
    }

    private getBoundingY () {
        return this._aabbHalfY;
    }

    private getBoundingZ () {
        return this._aabbHalfZ;
    }

    private setBoundingX (value: number) {
        if (this._boundingBox && this._culler) {
            this._boundingBox.halfExtents.x = value;
            this._culler.setBoundingBoxSize(this._boundingBox.halfExtents);
            this._aabbHalfX = value;
        }
    }

    private setBoundingY (value: number) {
        if (this._boundingBox && this._culler) {
            this._boundingBox.halfExtents.y = value;
            this._culler.setBoundingBoxSize(this._boundingBox.halfExtents);
            this._aabbHalfY = value;
        }
    }

    private setBoundingZ (value: number) {
        if (this._boundingBox && this._culler) {
            this._boundingBox.halfExtents.z = value;
            this._culler.setBoundingBoxSize(this._boundingBox.halfExtents);
            this._aabbHalfZ = value;
        }
    }

    /**
     * @ignore
     */
    get isPlaying () {
        return this._isPlaying;
    }

    get isPaused () {
        return this._isPaused;
    }

    get isStopped () {
        return this._isStopped;
    }

    get isEmitting () {
        return this._isEmitting;
    }

    get time () {
        return this._time;
    }

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _onBeforeSerialize (props) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return this.dataCulling ? props.filter((p) => !PARTICLE_MODULE_PROPERTY.includes(p) || (this[p] && this[p].enable)) : props;
    }

    public getNoisePreview (width: number, height: number): number[] {
        const out: number[] = [];
        if (this.processor) {
            this.processor.getNoisePreview(out, width, height);
        }
        return out;
    }
}

CCClass.fastDefine('cc.ParticleSystem', ParticleSystem, {
    capacity: 100,
    startColor: new GradientRange(),
    scaleSpace: Space.Local,
    startSize3D: true,
    startSizeX: new CurveRange(),
    startSizeY: new CurveRange(),
    startSizeZ: new CurveRange(),
    startSpeed: new CurveRange(),
    startRotation3D: false,
    startRotationX: new CurveRange(),
    startRotationY: new CurveRange(),
    startRotationZ: new CurveRange(),
    startDelay: new CurveRange(),
    startLifetime: new CurveRange(),
    duration: 5.0,
    loop: true,
    _prewarm: false,
    _simulationSpace: Space.Local,
    simulationSpeed: 1.0,
    playOnAwake: true,
    gravityModifier: new GradientRange(),
    rateOverTime: new GradientRange(),
    rateOverDistance: new GradientRange(),
    bursts: [],
    _renderCulling: false,
    _cullingMode: CullingMode.Pause,
    _aabbHalfX: 0,
    _aabbHalfY: 0,
    _aabbHalfZ: 0,
    _dataCulling: false,
    _colorOverLifetimeModule: new ColorOverLifetimeModule(),
    _shapeModule: new ShapeModule(),
    _sizeOvertimeModule: new SizeOvertimeModule(),
    _velocityOvertimeModule: new VelocityOvertimeModule(),
    _forceOvertimeModule: new ForceOvertimeModule(),
    _limitVelocityOvertimeModule: new LimitVelocityOvertimeModule(),
    _rotationOvertimeModule: new RotationOvertimeModule(),
    _textureAnimationModule: new TextureAnimationModule(),
    _noiseModule: new NoiseModule(),
    _trailModule: new TrailModule(),
    renderer: new ParticleSystemRenderer()
});

setClassAttr(ParticleSystem, 'capacity', 'type', CCInteger);
setClassAttr(ParticleSystem, 'capacity', 'range', [0, Number.POSITIVE_INFINITY]);
setClassAttr(ParticleSystem, 'capacity', 'displayOrder', 1);
setClassAttr(ParticleSystem, 'capacity', 'tooltip', 'i18n:particle_system.capacity');

setClassAttr(ParticleSystem, '_capacity', 'type', CCBoolean);

setClassAttr(ParticleSystem, 'startColor', 'type', GradientRange);
setClassAttr(ParticleSystem, 'startColor', 'serializable', true);
setClassAttr(ParticleSystem, 'startColor', 'displayOrder', 8);
setClassAttr(ParticleSystem, 'startColor', 'tooltip', 'i18n:particle_system.startColor');

setClassAttr(ParticleSystem, 'scaleSpace', 'type', Space);
setClassAttr(ParticleSystem, 'scaleSpace', 'serializable', true);
setClassAttr(ParticleSystem, 'scaleSpace', 'displayOrder', 9);
setClassAttr(ParticleSystem, 'scaleSpace', 'tooltip', 'i18n:particle_system.scaleSpace');

setClassAttr(ParticleSystem, 'startSize3D', 'type', CCBoolean);
setClassAttr(ParticleSystem, 'startSize3D', 'serializable', true);
setClassAttr(ParticleSystem, 'startSize3D', 'displayOrder', 10);
setClassAttr(ParticleSystem, 'startSize3D', 'tooltip', 'i18n:particle_system.startSize3D');

setClassAttr(ParticleSystem, 'startSizeX', 'type', CurveRange);
setClassAttr(ParticleSystem, 'startSizeX', 'formerlySerializedAs', 'startSize');
setClassAttr(ParticleSystem, 'startSizeX', 'range', [0, 1]);
setClassAttr(ParticleSystem, 'startSizeX', 'displayOrder', 10);
setClassAttr(ParticleSystem, 'startSizeX', 'visible', function (this: ParticleSystem) { return this.startSize3D; });
setClassAttr(ParticleSystem, 'startSizeX', 'tooltip', 'i18n:particle_system.startSizeX');

setClassAttr(ParticleSystem, 'startSizeY', 'type', CurveRange);
setClassAttr(ParticleSystem, 'startSizeY', 'range', [0, 1]);
setClassAttr(ParticleSystem, 'startSizeY', 'displayOrder', 10);
setClassAttr(ParticleSystem, 'startSizeY', 'visible', function (this: ParticleSystem) { return this.startSize3D; });
setClassAttr(ParticleSystem, 'startSizeY', 'tooltip', 'i18n:particle_system.startSizeY');

setClassAttr(ParticleSystem, 'startSizeZ', 'type', CurveRange);
setClassAttr(ParticleSystem, 'startSizeZ', 'range', [0, 1]);
setClassAttr(ParticleSystem, 'startSizeZ', 'displayOrder', 10);
setClassAttr(ParticleSystem, 'startSizeZ', 'visible', function (this: ParticleSystem) { return this.startSize3D; });
setClassAttr(ParticleSystem, 'startSizeZ', 'tooltip', 'i18n:particle_system.startSizeZ');

setClassAttr(ParticleSystem, 'startSpeed', 'type', CurveRange);
setClassAttr(ParticleSystem, 'startSpeed', 'range', [-1, 1]);
setClassAttr(ParticleSystem, 'startSpeed', 'displayOrder', 11);
setClassAttr(ParticleSystem, 'startSpeed', 'tooltip', 'i18n:particle_system.startSpeed');

setClassAttr(ParticleSystem, 'startRotation3D', 'type', CCBoolean);
setClassAttr(ParticleSystem, 'startRotation3D', 'displayOrder', 12);
setClassAttr(ParticleSystem, 'startRotation3D', 'tooltip', 'i18n:particle_system.startRotation3D');

setClassAttr(ParticleSystem, 'startRotationX', 'type', CurveRange);
setClassAttr(ParticleSystem, 'startRotationX', 'range', [-1, 1]);
setClassAttr(ParticleSystem, 'startRotationX', 'displayOrder', 12);
setClassAttr(ParticleSystem, 'startRotationX', 'visible', function (this: ParticleSystem) { return this.startRotation3D; });
setClassAttr(ParticleSystem, 'startRotationX', 'tooltip', 'i18n:particle_system.startRotationX');

setClassAttr(ParticleSystem, 'startRotationY', 'type', CurveRange);
setClassAttr(ParticleSystem, 'startRotationY', 'range', [-1, 1]);
setClassAttr(ParticleSystem, 'startRotationY', 'displayOrder', 12);
setClassAttr(ParticleSystem, 'startRotationY', 'visible', function (this: ParticleSystem) { return this.startRotation3D; });
setClassAttr(ParticleSystem, 'startRotationY', 'tooltip', 'i18n:particle_system.startRotationY');

setClassAttr(ParticleSystem, 'startRotationZ', 'type', CurveRange);
setClassAttr(ParticleSystem, 'startRotationZ', 'range', [-1, 1]);
setClassAttr(ParticleSystem, 'startRotationZ', 'displayOrder', 12);
setClassAttr(ParticleSystem, 'startRotationZ', 'visible', function (this: ParticleSystem) { return this.startRotation3D; });
setClassAttr(ParticleSystem, 'startRotationZ', 'tooltip', 'i18n:particle_system.startRotationZ');

setClassAttr(ParticleSystem, 'startDelay', 'type', CurveRange);
setClassAttr(ParticleSystem, 'startDelay', 'range', [0, 1]);
setClassAttr(ParticleSystem, 'startDelay', 'displayOrder', 6);
setClassAttr(ParticleSystem, 'startDelay', 'tooltip', 'i18n:particle_system.startDelay');

setClassAttr(ParticleSystem, 'startLifetime', 'type', CurveRange);
setClassAttr(ParticleSystem, 'startLifetime', 'range', [0, 1]);
setClassAttr(ParticleSystem, 'startLifetime', 'displayOrder', 7);
setClassAttr(ParticleSystem, 'startLifetime', 'tooltip', 'i18n:particle_system.startLifetime');

setClassAttr(ParticleSystem, 'duration', 'type', CCFloat);
setClassAttr(ParticleSystem, 'duration', 'displayOrder', 0);
setClassAttr(ParticleSystem, 'duration', 'tooltip', 'i18n:particle_system.duration');

setClassAttr(ParticleSystem, 'loop', 'type', CCBoolean);
setClassAttr(ParticleSystem, 'loop', 'displayOrder', 2);
setClassAttr(ParticleSystem, 'loop', 'tooltip', 'i18n:particle_system.loop');

setClassAttr(ParticleSystem, 'prewarm', 'type', CCBoolean);
setClassAttr(ParticleSystem, 'prewarm', 'displayOrder', 3);
setClassAttr(ParticleSystem, 'prewarm', 'tooltip', 'i18n:particle_system.prewarm');

setClassAttr(ParticleSystem, '_prewarm', 'type', CCBoolean);

setClassAttr(ParticleSystem, 'simulationSpace', 'type', Space);
setClassAttr(ParticleSystem, 'simulationSpace', 'displayOrder', 4);
setClassAttr(ParticleSystem, 'simulationSpace', 'tooltip', 'i18n:particle_system.simulationSpace');

setClassAttr(ParticleSystem, '_simulationSpace', 'type', Space);

setClassAttr(ParticleSystem, 'simulationSpeed', 'type', CCFloat);
setClassAttr(ParticleSystem, 'simulationSpeed', 'displayOrder', 5);
setClassAttr(ParticleSystem, 'simulationSpeed', 'tooltip', 'i18n:particle_system.simulationSpeed');

setClassAttr(ParticleSystem, 'playOnAwake', 'type', CCBoolean);
setClassAttr(ParticleSystem, 'playOnAwake', 'displayOrder', 2);
setClassAttr(ParticleSystem, 'playOnAwake', 'tooltip', 'i18n:particle_system.playOnAwake');

setClassAttr(ParticleSystem, 'gravityModifier', 'type', CurveRange);
setClassAttr(ParticleSystem, 'gravityModifier', 'range', [-1, 1]);
setClassAttr(ParticleSystem, 'gravityModifier', 'displayOrder', 13);
setClassAttr(ParticleSystem, 'gravityModifier', 'tooltip', 'i18n:particle_system.gravityModifier');

setClassAttr(ParticleSystem, 'rateOverTime', 'type', CurveRange);
setClassAttr(ParticleSystem, 'rateOverTime', 'range', [0, 1]);
setClassAttr(ParticleSystem, 'rateOverTime', 'displayOrder', 14);
setClassAttr(ParticleSystem, 'rateOverTime', 'tooltip', 'i18n:particle_system.rateOverTime');

setClassAttr(ParticleSystem, 'rateOverDistance', 'type', CurveRange);
setClassAttr(ParticleSystem, 'rateOverDistance', 'range', [0, 1]);
setClassAttr(ParticleSystem, 'rateOverDistance', 'displayOrder', 15);
setClassAttr(ParticleSystem, 'rateOverDistance', 'tooltip', 'i18n:particle_system.rateOverDistance');

setClassAttr(ParticleSystem, 'bursts', 'type', [Burst]);
setClassAttr(ParticleSystem, 'bursts', 'displayOrder', 16);
setClassAttr(ParticleSystem, 'bursts', 'tooltip', 'i18n:particle_system.bursts');

setClassAttr(ParticleSystem, 'renderCulling', 'type', CCBoolean);
setClassAttr(ParticleSystem, 'renderCulling', 'displayOrder', 27);
setClassAttr(ParticleSystem, 'renderCulling', 'tooltip', 'i18n:particle_system.renderCulling');

setClassAttr(ParticleSystem, '_renderCulling', 'type', CCBoolean);

setClassAttr(ParticleSystem, 'cullingMode', 'type', CullingMode);
setClassAttr(ParticleSystem, 'cullingMode', 'displayOrder', 17);
setClassAttr(ParticleSystem, 'cullingMode', 'tooltip', 'i18n:particle_system.cullingMode');

setClassAttr(ParticleSystem, '_cullingMode', 'type', CullingMode);

setClassAttr(ParticleSystem, 'aabbHalfX', 'type', CCFloat);
setClassAttr(ParticleSystem, 'aabbHalfX', 'displayOrder', 17);
setClassAttr(ParticleSystem, 'aabbHalfX', 'tooltip', 'i18n:particle_system.aabbHalfX');

setClassAttr(ParticleSystem, '_aabbHalfX', 'type', CCFloat);

setClassAttr(ParticleSystem, 'aabbHalfY', 'type', CCFloat);
setClassAttr(ParticleSystem, 'aabbHalfY', 'displayOrder', 17);
setClassAttr(ParticleSystem, 'aabbHalfY', 'tooltip', 'i18n:particle_system.aabbHalfY');

setClassAttr(ParticleSystem, '_aabbHalfY', 'type', CCFloat);

setClassAttr(ParticleSystem, 'aabbHalfZ', 'type', CCFloat);
setClassAttr(ParticleSystem, 'aabbHalfZ', 'displayOrder', 17);
setClassAttr(ParticleSystem, 'aabbHalfZ', 'tooltip', 'i18n:particle_system.aabbHalfZ');

setClassAttr(ParticleSystem, '_aabbHalfZ', 'type', CCFloat);

setClassAttr(ParticleSystem, 'dataCulling', 'type', CCBoolean);
setClassAttr(ParticleSystem, 'dataCulling', 'displayOrder', 28);
setClassAttr(ParticleSystem, 'dataCulling', 'tooltip', 'i18n:particle_system.dataCulling');

setClassAttr(ParticleSystem, '_dataCulling', 'type', CCBoolean);
setClassAttr(ParticleSystem, '_dataCulling', 'formerlySerializedAs', 'enableCulling');

setClassAttr(ParticleSystem, 'sharedMaterials', 'override', true);
setClassAttr(ParticleSystem, 'sharedMaterials', 'type', Material);
setClassAttr(ParticleSystem, 'sharedMaterials', 'visible', false);
setClassAttr(ParticleSystem, 'sharedMaterials', 'displayName', 'Materials');

setClassAttr(ParticleSystem, 'colorOverLifetimeModule', 'type', ColorOverLifetimeModule);
setClassAttr(ParticleSystem, 'colorOverLifetimeModule', 'displayOrder', 23);
setClassAttr(ParticleSystem, 'colorOverLifetimeModule', 'tooltip', 'i18n:particle_system.colorOverLifetimeModule');

setClassAttr(ParticleSystem, '_colorOverLifetimeModule', 'type', ColorOverLifetimeModule);

setClassAttr(ParticleSystem, 'shapeModule', 'type', ShapeModule);
setClassAttr(ParticleSystem, 'shapeModule', 'displayOrder', 17);
setClassAttr(ParticleSystem, 'shapeModule', 'tooltip', 'i18n:particle_system.shapeModule');

setClassAttr(ParticleSystem, '_shapeModule', 'type', ShapeModule);

setClassAttr(ParticleSystem, 'sizeOvertimeModule', 'type', SizeOvertimeModule);
setClassAttr(ParticleSystem, 'sizeOvertimeModule', 'displayOrder', 17);
setClassAttr(ParticleSystem, 'sizeOvertimeModule', 'tooltip', 'i18n:particle_system.sizeOvertimeModule');

setClassAttr(ParticleSystem, '_sizeOvertimeModule', 'type', SizeOvertimeModule);

setClassAttr(ParticleSystem, 'velocityOvertimeModule', 'type', VelocityOvertimeModule);
setClassAttr(ParticleSystem, 'velocityOvertimeModule', 'displayOrder', 18);
setClassAttr(ParticleSystem, 'velocityOvertimeModule', 'tooltip', 'i18n:particle_system.velocityOvertimeModul');

setClassAttr(ParticleSystem, '_velocityOvertimeModule', 'type', VelocityOvertimeModule);

setClassAttr(ParticleSystem, 'forceOvertimeModule', 'type', ForceOvertimeModule);
setClassAttr(ParticleSystem, 'forceOvertimeModule', 'displayOrder', 19);
setClassAttr(ParticleSystem, 'forceOvertimeModule', 'tooltip', 'i18n:particle_system.forceOvertimeModule');

setClassAttr(ParticleSystem, '_forceOvertimeModule', 'type', ForceOvertimeModule);

setClassAttr(ParticleSystem, 'limitVelocityOvertimeModule', 'type', LimitVelocityOvertimeModule);
setClassAttr(ParticleSystem, 'limitVelocityOvertimeModule', 'displayOrder', 20);
setClassAttr(ParticleSystem, 'limitVelocityOvertimeModule', 'tooltip', 'i18n:particle_system.limitVelocityOvertimeModule');

setClassAttr(ParticleSystem, '_limitVelocityOvertimeModule', 'type', LimitVelocityOvertimeModule);

setClassAttr(ParticleSystem, 'rotationOvertimeModule', 'type', RotationOvertimeModule);
setClassAttr(ParticleSystem, 'rotationOvertimeModule', 'displayOrder', 22);
setClassAttr(ParticleSystem, 'rotationOvertimeModule', 'tooltip', 'i18n:particle_system.rotationOvertimeModule');

setClassAttr(ParticleSystem, '_rotationOvertimeModule', 'type', RotationOvertimeModule);

setClassAttr(ParticleSystem, 'textureAnimationModule', 'type', TextureAnimationModule);
setClassAttr(ParticleSystem, 'textureAnimationModule', 'displayOrder', 24);
setClassAttr(ParticleSystem, 'textureAnimationModule', 'tooltip', 'i18n:particle_system.textureAnimationModule');

setClassAttr(ParticleSystem, '_textureAnimationModule', 'type', TextureAnimationModule);

setClassAttr(ParticleSystem, 'noiseModule', 'type', NoiseModule);
setClassAttr(ParticleSystem, 'noiseModule', 'displayOrder', 24);
setClassAttr(ParticleSystem, 'noiseModule', 'tooltip', 'i18n:particle_system.noiseModule');

setClassAttr(ParticleSystem, '_noiseModule', 'type', NoiseModule);

setClassAttr(ParticleSystem, 'trailModule', 'type', TrailModule);
setClassAttr(ParticleSystem, 'trailModule', 'displayOrder', 25);
setClassAttr(ParticleSystem, 'trailModule', 'tooltip', 'i18n:particle_system.trailModule');

setClassAttr(ParticleSystem, '_trailModule', 'type', TrailModule);

setClassAttr(ParticleSystem, 'renderer', 'type', ParticleSystemRenderer);
setClassAttr(ParticleSystem, 'renderer', 'displayOrder', 26);
setClassAttr(ParticleSystem, 'renderer', 'tooltip', 'i18n:particle_system.renderer');