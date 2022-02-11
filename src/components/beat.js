import { toLong } from 'ip';
import {BEAT_WARMUP_OFFSET, BEAT_WARMUP_SPEED, BEAT_WARMUP_TIME} from '../constants/beat';
import {getHorizontalPosition, getVerticalPosition, NoteErrorType, SWORD_OFFSET} from '../utils';
const COLORS = require('../constants/colors.js');

const auxObj3D = new THREE.Object3D();
const collisionZThreshold = -2.6;
const BEAT_WARMUP_ROTATION_CHANGE = Math.PI / 5;
const BEAT_WARMUP_ROTATION_OFFSET = 0.4;
const BEAT_WARMUP_ROTATION_TIME = 0.75;
const DESTROYED_SPEED = 1.0;
const ONCE = {once: true};

const SOUND_STATE = {
  initial: 0,
  waitingForHitSound: 1,
  hitPlayed: 2
};

/**
 * Bears, beats, Battlestar Galactica.
 * Create beat from pool, collision detection, movement, scoring.
 */
AFRAME.registerComponent('beat', {
  schema: {
    index: {default: 0},
    anticipationPosition: {default: 0},
    color: {default: 'red', oneOf: ['red', 'blue']},
    cutDirection: {default: 'down'},
    rotationOffset: {default: 0},
    debug: {default: false},
    horizontalPosition: {default: 1},
    size: {default: 0.40},
    speed: {default: 8.0},
    type: {default: 'arrow', oneOf: ['arrow', 'dot', 'mine']},
    verticalPosition: {default: 1},
    warmupPosition: {default: 0},
    time: {default: 0},
    anticipationTime: {default: 0},
    warmupTime: {default: 0},
    warmupSpeed: {default: 0},
    // Loading cubes
    loadingCube: {default: false},
    visible: {default: true},
    animating: {default: true},
  },

  materialColor: {
    blue: COLORS.BEAT_BLUE,
    red: COLORS.BEAT_RED
  },

  cutColor: {
    blue: '#fff',
    red: '#fff'
  },

  models: {
    arrow: 'beatObjTemplate',
    dot: 'beatObjTemplate',
    mine: 'mineObjTemplate'
  },

  signModels: {
    arrowred: 'arrowRedObjTemplate',
    arrowblue: 'arrowBlueObjTemplate',
    dotred: 'dotRedObjTemplate',
    dotblue: 'dotBlueObjTemplate'
  },

  orientations: [180, 0, 270, 90, 225, 135, 315, 45, 0],

  rotations: {
    up: 180,
    down: 0,
    left: 270,
    right: 90,
    upleft: 225,
    upright: 135,
    downleft: 315,
    downright: 45
  },

  init: function () {
    this.beatBoundingBox = new THREE.Box3();
    this.beatBigBoundingBox = new THREE.Box3();
    this.currentRotationWarmupTime = 0;
    this.cutDirection = new THREE.Vector3();
    this.destroyed = false;
    this.gravityVelocity = 0;

    this.hitEventDetail = {};
    this.hitSoundState = SOUND_STATE.initial;

    this.poolName = undefined;
    this.returnToPoolTimeStart = undefined;
    this.rotationAxis = new THREE.Vector3();

    this.beams = document.getElementById('beams').components.beams;
    this.saberEls = this.el.sceneEl.querySelectorAll('[saber-controls]');
    this.headset = this.el.sceneEl.querySelectorAll('.headset')[0];
    this.replayLoader = this.el.sceneEl.components['replay-loader'];
    this.settings = this.el.sceneEl.components['settings'];
    this.song = this.el.sceneEl.components.song;

    this.scoreEl = null;
    this.scoreElTime = undefined;
    this.startPositionZ = undefined;
    this.rightCutPlanePoints = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ];
    this.leftCutPlanePoints = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ];

    this.mineParticles = document.getElementById('mineParticles');
    this.wrongElLeft = document.getElementById('wrongLeft');
    this.wrongElRight = document.getElementById('wrongRight');
    this.missElLeft = document.getElementById('missLeft');
    this.missElRight = document.getElementById('missRight');
    this.particles = document.getElementById('saberParticles');

    this.superCuts = document.querySelectorAll('.superCutFx');
    this.superCutIdx = 0;

    this.explodeEventDetail = {position: new THREE.Vector3(), rotation: new THREE.Euler()};
    this.saberColors = {right: 'blue', left: 'red'};
    this.glow = null;

    this.onEndStroke = this.onEndStroke.bind(this);

    this.rotEuler = new THREE.Euler();
    this.strokeDirectionVector = new THREE.Vector3();
    this.bladeTipPosition = new THREE.Vector3();
    this.startStrokePosition = new THREE.Vector3();

    this.initBlock();
    if (this.data.type === 'mine') {
      this.initMineFragments();
    } else {
      this.initFragments();
    };
  },

  update: function (oldData) {
    this.updateBlock();
    this.updateFragments();

    if (this.data.type === 'mine') {
      this.poolName = `pool__beat-mine`;
    } else {
      this.poolName = `pool__beat-${this.data.type}-${this.data.color}`;
    }

    if (this.data.loadingCube) {
      if (!oldData.visible && this.data.visible) {
        this.signEl.object3D.visible = false;
        this.setObjModelFromTemplate(this.signEl, this.signModels[this.data.type + this.data.color], this.el.sceneEl.systems.materials.clearStageAdditive);
        this.el.object3D.rotation.y = (this.data.color == 'red' ? 1 : -1) * Math.PI / 4;
        this.el.object3D.rotation.z = (this.data.color == 'red' ? 1 : -1) * Math.PI / 4;
      } else if (oldData.visible && !this.data.visible) {
        this.returnToPool();
      }
    }
  },

  pause: function () {
    this.el.object3D.visible = false;
    if (this.data.type !== 'mine') {
      this.partLeftEl.object3D.visible = false;
      this.partRightEl.object3D.visible = false;
    }
  },

  play: function () {
    // this.glow = this.el.sceneEl.components['pool__beat-glow'].requestEntity();
    if (!this.hitSaberEl) {
      this.blockEl.object3D.visible = true;
      this.destroyed = false;
      this.el.object3D.visible = true;
    }
  },

  updatePosition: function () {
    const el = this.el;
    const data = this.data;
    const position = el.object3D.position;
    const rotation = el.object3D.rotation;
    const song = this.song;

    var newPosition = 0;

    var timeOffset = data.time - song.getCurrentTime() - data.anticipationTime - data.warmupTime;
    
    var t = timeOffset / -data.anticipationTime - data.warmupTime;

    var currentRotationWarmupTime = timeOffset;

    if (timeOffset <= -data.warmupTime) {
      newPosition = data.anticipationPosition;
      timeOffset += data.warmupTime;
      newPosition += -timeOffset * data.speed;
      if (!this.settings.settings.noEffects && Math.abs(timeOffset) < 1) {
        this.beams.newBeam(data.color, data.anticipationPosition);
      }
    } else {
      newPosition = data.anticipationPosition + data.warmupPosition + data.warmupSpeed * -timeOffset;
    }

    newPosition += this.headset.object3D.position.z;
    position.z = newPosition;

    if (currentRotationWarmupTime <= -data.warmupTime) {
      currentRotationWarmupTime += data.warmupTime;

      let warmupRotationTime = BEAT_WARMUP_ROTATION_TIME / (20 / data.anticipationPosition); // Closer anticipation - faster the rotation.
        
      const progress = warmupRotationTime <= currentRotationWarmupTime ? AFRAME.ANIME.easings.easeOutBack(
        currentRotationWarmupTime / warmupRotationTime) : 1.0;
        el.object3D.rotation.z = this.rotationZStart + (progress * this.rotationZChange);
    }

    if (t >= 0.5 && t <= 1 && data.type != 'mine') {
      var headPseudoLocalPos = this.headset.object3D.position.clone();
      var localPosition = position.clone();

      headPseudoLocalPos.y = THREE.Math.lerp(headPseudoLocalPos.y, localPosition.y, 0.8);
      this.rotEuler.copy(el.object3D.rotation);
      el.object3D.lookAt(headPseudoLocalPos);
      el.object3D.rotation.x = THREE.Math.lerp(this.rotEuler.x, el.object3D.rotation.x, 0.4 * t);
      el.object3D.rotation.y = THREE.Math.lerp(this.rotEuler.y, el.object3D.rotation.y, 0.4 * t);
      el.object3D.rotation.z = this.rotEuler.z;
    }
  },

  tock: function (time, timeDelta) {
    if (this.data.loadingCube) {
      if (this.data.animating) {
        if (!this.signEl.object3D.visible && this.signEl.getObject3D("mesh").material) {
          this.signEl.object3D.visible = true;
        }
        let object = this.el.object3D;
        const m = Math.cos(time / 300);
        const m2 = Math.cos(time / 300 - Math.PI / 2);
        object.rotation.y += m2 * 0.003;
        object.rotation.z += (this.data.color == 'red' ? 1 : -1) * m2 * 0.003;
        object.scale.multiplyScalar(m * 0.003 + 1);
      }
      
      return;
    }

    if (!this.settings.realHitsounds) { 
      this.checkStaticHitsound();
      if (this.hitSoundState == SOUND_STATE.waitingForHitSound) {
        return;
      }
    }
    const el = this.el;
    const position = el.object3D.position;

    if (this.destroyed) {
      this.tockDestroyed(timeDelta);
      // Check to remove score entity from pool.
    } else {
      if (position.z > collisionZThreshold) { this.checkCollisions(); }

      this.updatePosition();

      if (this.data.type != 'mine' && position.z > 0 && this.replayNote.score != NoteErrorType.Miss && this.song.getCurrentTime() > this.replayNote.time) {
        this.showScore();
        this.destroyBeat(this.saberEls[this.replayNote.colorType]);
      } else {
        this.backToPool = position.z >= 2;
        if (this.backToPool) { this.missHit(); }
      }
    }
    if (this.hitboxObject) {
      this.hitboxObject.visible = !this.destroyed && this.settings.settings.showHitboxes;
    }
    if (this.smallHitObject) {
      this.smallHitObject.visible = !this.destroyed && this.settings.settings.showHitboxes;
    }
    
    this.returnToPool();
  },

  /**
   * Called when summoned by beat-generator.
   */
  onGenerate: function () {
    const data = this.data;
    const el = this.el;

    // Set position.
    el.object3D.position.set(
      getHorizontalPosition(data.horizontalPosition),
      getVerticalPosition(data.verticalPosition),
      data.anticipationPosition + data.warmupPosition
    );
    el.object3D.rotation.set(0, 0, THREE.Math.degToRad(this.rotations[data.cutDirection] + (this.data.rotationOffset ? this.data.rotationOffset : 0.0)));

    // Set up rotation warmup.
    this.startRotationZ = this.el.object3D.rotation.z;
    this.currentRotationWarmupTime = 0;
    this.rotationZChange = BEAT_WARMUP_ROTATION_CHANGE;
    if (Math.random > 0.5) { this.rotationZChange *= -1; }
    this.el.object3D.rotation.z -= this.rotationZChange;
    this.rotationZStart = this.el.object3D.rotation.z;
    
    // Reset the state properties.
    this.returnToPoolTimeStart = undefined;
    this.hitSoundState = SOUND_STATE.initial;
    this.hitSaberEl = null;

    // Find corresponding score from replay
    this.replayNote = null;
    if (data.type == 'mine') {
      // Reset mine.
      this.blockEl.getObject3D('mesh').material = this.el.sceneEl.systems.materials['mineMaterial' + this.data.color];
      this.resetMineFragments();

      const bombs = this.replayLoader.bombs;
      if (bombs) {
        for (var i = 0; i < bombs.length; i++) {
          if (bombs[i].time < (data.time + 0.08) && bombs[i].time > data.time - 0.08) {
            this.replayNote = bombs[i];
            break;
          }
        }
      }
    } else {
      const notes = this.replayLoader.allStructs;
      const index = this.data.index;
      var result;
      for (var i = 0; i < notes.length; i++) {
        if (notes[i].index == index) {
          result = notes[i];
          break;
        }
      }
      this.replayNote = result;
    }

    if (this.settings.settings.highlightErrors && this.replayNote && this.replayNote.score < 0) {
      if (data.type == 'mine') {
        this.blockEl.getObject3D('mesh').material = this.el.sceneEl.systems.materials['mineMaterialyellow'];
      } else {
        this.blockEl.setAttribute('material', "color: yellow");
      }
    }

    this.updatePosition();

    if (!this.hitboxObject) {
      let itsMine = this.data.type === 'mine';
      const hitbox = new THREE.WireframeGeometry(itsMine ? new THREE.SphereGeometry(0.18, 16, 8) : new THREE.BoxGeometry(0.8, 0.5, 1.0));
      const material = new THREE.LineBasicMaterial({
        color: 0xff0000,
        linewidth: 1
      });
      const line = new THREE.LineSegments(hitbox, material);
      line.geometry.computeBoundingBox();
      line.visible = this.settings.settings.showHitboxes;
      el.object3D.add(line);
      if (!itsMine) {
        line.position.z += 0.25;

        const smallhitbox = new THREE.WireframeGeometry(new THREE.BoxGeometry(0.48, 0.48, 0.48));
        const material2 = new THREE.LineBasicMaterial({
          color: 0xff00ff,
          linewidth: 1
        });
        const line2 = new THREE.LineSegments(smallhitbox, material2);
        line2.geometry.computeBoundingBox();
        line2.visible = this.settings.settings.showHitboxes;
          
        el.object3D.add(line2);

        this.smallHitObject = line2;
      }
      this.hitboxObject = line;
    }
  },

  initBlock: function () {
    var el = this.el;
    var blockEl = this.blockEl = document.createElement('a-entity');
    var signEl = this.signEl = document.createElement('a-entity');

    // Small offset to prevent z-fighting when the blocks are far away
    signEl.object3D.position.z += 0.02;
    blockEl.appendChild(signEl);
    el.appendChild(blockEl);
  },

  updateBlock: function () {
    const blockEl = this.blockEl;
    const signEl = this.signEl;
    if (!blockEl) { return; }

    if (this.data.type === 'mine') {
      blockEl.setAttribute('material', {
        roughness: 0.38,
        metalness: 0.48,
        sphericalEnvMap: '#mineTexture',
        emissive: new THREE.Color(COLORS.MINE_RED_EMISSION),
        color: new THREE.Color(COLORS.MINE_RED),
      });
    } else {
      blockEl.setAttribute('material', {
        metalness: 0.7,
        roughness: 0.1,
        sphericalEnvMap: '#envmapTexture',
        emissive: this.materialColor[this.data.color],
        emissiveIntensity: 0.05,
        color: this.materialColor[this.data.color]
      });
    }
    this.setObjModelFromTemplate(blockEl, this.models[this.data.type]);

    // Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
    blockEl.object3D.scale.set(1, 1, 1);
    blockEl.object3D.scale.multiplyScalar(3.45).multiplyScalar(this.data.size);

    if (this.data.type !== 'mine') {
      // Uncomment in case of new Chrome version 
      // signEl.setAttribute('materials', "name: clearStageAdditive");
      this.setObjModelFromTemplate(signEl, this.signModels[this.data.type + this.data.color], this.el.sceneEl.systems.materials.clearStageAdditive);
    }
  },

  initFragments: function () {
    var cutEl;
    var partEl;

    partEl = this.partLeftEl = document.createElement('a-entity');
    cutEl = this.cutLeftEl = document.createElement('a-entity');

    partEl.appendChild(cutEl);
    this.el.appendChild(partEl);

    partEl = this.partRightEl = document.createElement('a-entity');
    cutEl = this.cutRightEl = document.createElement('a-entity');

    partEl.appendChild(cutEl);
    this.el.appendChild(partEl);

    this.initCuttingClippingPlanes();
  },

  initMineFragments: function () {
    var fragment;
    var fragments = this.el.sceneEl.systems['mine-fragments-loader'].fragments.children;
    var material = this.el.sceneEl.systems.materials['mineMaterial' + this.data.color];

    this.randVec = new THREE.Vector3(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI);

    this.mineFragments = [];
    this.mineBroken = document.createElement('a-entity');
    this.el.appendChild(this.mineBroken);

    for (var i = 0; i < fragments.length; i++) {
      fragment = new THREE.Mesh(fragments[i].geometry, material);
      fragment.speed = new THREE.Vector3();
      fragment.speed.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      this.mineFragments.push(fragment);
      this.mineBroken.object3D.add(fragment);
    }
  },

  updateFragments: function () {
    var cutLeftEl = this.cutLeftEl;
    var cutRightEl = this.cutRightEl;
    var partLeftEl = this.partLeftEl;
    var partRightEl = this.partRightEl;
    var fragment;
    if (!partLeftEl) { return; }
    if (this.data.type === 'mine') {
      this.resetMineFragments();
      return;
    }

    partLeftEl.setAttribute('material', {
      metalness: 0.7,
      roughness: 0.1,
      sphericalEnvMap: '#envmapTexture',
      emissive: this.materialColor[this.data.color],
      emissiveIntensity: 0.05,
      color: this.materialColor[this.data.color],
      side: 'double'
    });
    this.setObjModelFromTemplate(partLeftEl, this.models.dot);
    // Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
    partLeftEl.object3D.scale.set(1, 1, 1);
    partLeftEl.object3D.scale.multiplyScalar(3.45).multiplyScalar(this.data.size);
    partLeftEl.object3D.visible = false;

    cutLeftEl.setAttribute('material', {
      shader: 'flat',
      color: this.data.cutColor,
      side: 'double'
    });
    this.setObjModelFromTemplate(cutLeftEl, this.models.dot);

    partRightEl.setAttribute('material', {
      metalness: 0.7,
      roughness: 0.1,
      sphericalEnvMap: '#envmapTexture',
      emissive: this.materialColor[this.data.color],
      emissiveIntensity: 0.05,
      color: this.materialColor[this.data.color],
      side: 'double'
    });
    this.setObjModelFromTemplate(partRightEl, this.models.dot);
    // Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
    partRightEl.object3D.scale.set(1, 1, 1);
    partRightEl.object3D.scale.multiplyScalar(3.45).multiplyScalar(this.data.size);
    partRightEl.object3D.visible = false;

    cutRightEl.setAttribute('material', {
      shader: 'flat',
      color: this.data.cutColor,
      side: 'double'
    });
    this.setObjModelFromTemplate(cutRightEl, this.models.dot);
  },

  resetMineFragments: function () {
    if (this.data.type !== 'mine') { return; }
    for (let i = 0; i < this.mineFragments.length; i++) {
      let fragment = this.mineFragments[i];
      fragment.visible = false;
      fragment.position.set(0, 0, 0);
      fragment.scale.set(1, 1, 1);
      fragment.speed.set(
        Math.random() * 5 - 2.5,
        Math.random() * 5 - 2.5,
        Math.random() * 5 - 2.5);
    }
  },

  missHit: function (hand) {
    if (this.data.type === 'mine') {
      if (this.replayNote) {
        this.postScoreEvent();
      }
      return; 
    }

    if (this.replayNote.score > 0) {
      this.el.emit('wrongMiss', null, true);
    }
    
    this.postScoreEvent();
    this.showScore(hand);
    
    if (AFRAME.utils.getUrlParameter('synctest')) {
      console.log(this.el.sceneEl.components.song.getCurrentTime());
    }
  },

  postScoreEvent: function () {
    const timeToScore = this.replayNote.time - this.song.getCurrentTime();

    const payload = {index: this.replayNote.i};
    const scoreChanged = () => this.el.emit('scoreChanged', payload, true);
    if (timeToScore < 0) {
      scoreChanged();
    } else {
      setTimeout(scoreChanged, timeToScore * 1000);
    }
  },

  destroyMine: function () {
    if (!this.settings.settings.reducedDebris) {
      for (let i = 0; i < this.mineFragments.length; i++) {
        this.mineFragments[i].visible = true;
      }
  
      this.blockEl.object3D.visible = false;
      this.destroyed = true;
      this.gravityVelocity = 0.1;
      this.returnToPoolTimer = 800;
    } else {
      this.destroyed = true;
      this.returnToPool(true);
    }
    
    if (!this.settings.settings.noEffects) {
      this.explodeEventDetail.position.copy(this.el.object3D.position);
      this.explodeEventDetail.rotation.copy(this.randVec);
      this.mineParticles.emit('explode', this.explodeEventDetail, false);
    }
  },

  destroyBeat: (function () {
    var parallelPlaneMaterial = new THREE.MeshBasicMaterial({
      color: '#00008b',
      side: THREE.DoubleSide
    });
    var planeMaterial = new THREE.MeshBasicMaterial({color: 'grey', side: THREE.DoubleSide});
    var point1 = new THREE.Vector3();
    var point2 = new THREE.Vector3();
    var point3 = new THREE.Vector3();

    return function (saberEl) {
      if (!this.settings.settings.reducedDebris) {
        var coplanarPoint;
        var cutThickness = this.cutThickness = 0.02;
        var direction = this.cutDirection;
        var leftBorderInnerPlane = this.leftBorderInnerPlane;
        var leftBorderOuterPlane = this.leftBorderOuterPlane;
        var leftCutPlane = this.leftCutPlane;
        var planeGeometry;
        var planeMesh;
        var rightBorderInnerPlane = this.rightBorderInnerPlane;
        var rightBorderOuterPlane = this.rightBorderOuterPlane;
        var rightCutPlane = this.rightCutPlane;
        var cutPlaneComponent = saberEl.components['cut-plane'];

        point1.copy(cutPlaneComponent.currentFrameSaberTop);
        point2.copy(cutPlaneComponent.currentFrameSaberCenter);
        point3.copy(cutPlaneComponent.previousFrameSaberTop);
        direction.copy(point1).sub(point3);

        this.partRightEl.object3D.position.set(0, 0, 0);
        this.partRightEl.object3D.rotation.set(0, 0, 0);
        this.partRightEl.object3D.updateMatrixWorld();

        this.partRightEl.object3D.worldToLocal(this.rightCutPlanePoints[0].copy(point1));
        this.partRightEl.object3D.worldToLocal(this.rightCutPlanePoints[1].copy(point2));
        this.partRightEl.object3D.worldToLocal(this.rightCutPlanePoints[2].copy(point3));

        this.partLeftEl.object3D.position.set(0, 0, 0);
        this.partLeftEl.object3D.rotation.set(0, 0, 0);
        this.partLeftEl.object3D.updateMatrixWorld();

        this.partLeftEl.object3D.worldToLocal(this.leftCutPlanePoints[0].copy(point3));
        this.partLeftEl.object3D.worldToLocal(this.leftCutPlanePoints[1].copy(point2));
        this.partLeftEl.object3D.worldToLocal(this.leftCutPlanePoints[2].copy(point1));

        this.generateCutClippingPlanes();

        if (this.data.debug) {
          coplanarPoint = new THREE.Vector3();
          planeGeometry = new THREE.PlaneGeometry(4.0, 4.0, 1.0, 1.0);

          rightCutPlane.coplanarPoint(coplanarPoint);
          planeGeometry.lookAt(rightCutPlane.normal);
          planeGeometry.translate(coplanarPoint.x, coplanarPoint.y, coplanarPoint.z);

          planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
          this.el.sceneEl.setObject3D('rightCutPlane', planeMesh);

          planeGeometry = new THREE.PlaneGeometry(4.0, 4.0, 1.0, 1.0);

          rightBorderOuterPlane.coplanarPoint(coplanarPoint);
          planeGeometry.lookAt(rightBorderOuterPlane.normal);
          planeGeometry.translate(coplanarPoint.x, coplanarPoint.y, coplanarPoint.z);

          const parallelPlaneMesh = new THREE.Mesh(planeGeometry, parallelPlaneMaterial);
          this.el.sceneEl.setObject3D('planeParallel', parallelPlaneMesh);
        }

        this.blockEl.object3D.visible = false;

        const partRightMaterial = this.partRightEl.getObject3D('mesh').material;
        partRightMaterial.clippingPlanes = partRightMaterial.clippingPlanes || [];
        partRightMaterial.clippingPlanes.length = 0;
        partRightMaterial.clippingPlanes.push(rightCutPlane);

        const cutRightMaterial = this.cutRightEl.getObject3D('mesh').material;
        cutRightMaterial.clippingPlanes = cutRightMaterial.clippingPlanes || [];
        cutRightMaterial.clippingPlanes.length = 0;
        cutRightMaterial.clippingPlanes.push(rightBorderOuterPlane);
        cutRightMaterial.clippingPlanes.push(rightBorderInnerPlane);

        const partLeftMaterial = this.partLeftEl.getObject3D('mesh').material;
        partLeftMaterial.clippingPlanes = partLeftMaterial.clippingPlanes || [];
        partLeftMaterial.clippingPlanes.length = 0;
        partLeftMaterial.clippingPlanes.push(leftCutPlane);

        const cutLeftMaterial = this.cutLeftEl.getObject3D('mesh').material;
        cutLeftMaterial.clippingPlanes = cutLeftMaterial.clippingPlanes || [];
        cutLeftMaterial.clippingPlanes.length = 0;
        cutLeftMaterial.clippingPlanes.push(leftBorderInnerPlane);
        cutLeftMaterial.clippingPlanes.push(leftBorderOuterPlane);

        this.partLeftEl.object3D.visible = true;
        this.partRightEl.object3D.visible = true;

        this.el.sceneEl.renderer.localClippingEnabled = true;
        this.destroyed = true;
        this.gravityVelocity = 0.1;

        this.rotationAxis.copy(this.rightCutPlanePoints[0]).sub(this.rightCutPlanePoints[1]);

        this.returnToPoolTimer = 800;

        auxObj3D.up.copy(rightCutPlane.normal);
        auxObj3D.lookAt(direction);
      } else {
        this.destroyed = true;
        if (!this.settings.realHitsounds && this.hitSoundState != SOUND_STATE.hitPlayed) {
          this.el.object3D.visible = false;
          this.hitSoundState = SOUND_STATE.waitingForHitSound;
        } else {
          this.returnToPool(true);
        }
      }

      // if (!this.settings.settings.noEffects) {
      //   this.explodeEventDetail.position = this.el.object3D.position;
      //   this.explodeEventDetail.rotation = auxObj3D.rotation;
      //   this.particles.emit('explode', this.explodeEventDetail, false);
      // }
    };
  })(),

  initCuttingClippingPlanes: function () {
    this.leftCutPlanePointsWorld = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ];
    this.rightCutPlanePointsWorld = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ];

    this.rightCutPlane = new THREE.Plane();
    this.rightBorderOuterPlane = new THREE.Plane();
    this.rightBorderInnerPlane = new THREE.Plane();

    this.leftCutPlane = new THREE.Plane();
    this.leftBorderOuterPlane = new THREE.Plane();
    this.leftBorderInnerPlane = new THREE.Plane();
  },

  generateCutClippingPlanes: function () {
    var leftBorderInnerPlane = this.leftBorderInnerPlane;
    var leftBorderOuterPlane = this.leftBorderOuterPlane;
    var leftCutPlane = this.leftCutPlane;
    var leftCutPlanePointsWorld = this.leftCutPlanePointsWorld;
    var partLeftEl = this.partLeftEl;
    var partRightEl = this.partRightEl;
    var rightBorderInnerPlane = this.rightBorderInnerPlane;
    var rightBorderOuterPlane = this.rightBorderOuterPlane;
    var rightCutPlane = this.rightCutPlane;
    var rightCutPlanePointsWorld = this.rightCutPlanePointsWorld;

    partRightEl.object3D.updateMatrixWorld();
    partRightEl.object3D.localToWorld(
      rightCutPlanePointsWorld[0].copy(this.rightCutPlanePoints[0]));
    partRightEl.object3D.localToWorld(
      rightCutPlanePointsWorld[1].copy(this.rightCutPlanePoints[1]));
    partRightEl.object3D.localToWorld(
      rightCutPlanePointsWorld[2].copy(this.rightCutPlanePoints[2]));

    partLeftEl.object3D.updateMatrixWorld();
    partLeftEl.object3D.localToWorld(
      leftCutPlanePointsWorld[0].copy(this.leftCutPlanePoints[0]));
    partLeftEl.object3D.localToWorld(
      leftCutPlanePointsWorld[1].copy(this.leftCutPlanePoints[1]));
    partLeftEl.object3D.localToWorld(
      leftCutPlanePointsWorld[2].copy(this.leftCutPlanePoints[2]));

    rightCutPlane.setFromCoplanarPoints(
      rightCutPlanePointsWorld[0], rightCutPlanePointsWorld[1], rightCutPlanePointsWorld[2]);
    rightBorderOuterPlane.set(rightCutPlane.normal,
                              rightCutPlane.constant + this.cutThickness);

    leftCutPlane.setFromCoplanarPoints(
      leftCutPlanePointsWorld[0], leftCutPlanePointsWorld[1], leftCutPlanePointsWorld[2]);
    leftBorderOuterPlane.set(leftCutPlane.normal, leftCutPlane.constant + this.cutThickness);

    rightBorderInnerPlane.setFromCoplanarPoints(
      rightCutPlanePointsWorld[2], rightCutPlanePointsWorld[1], rightCutPlanePointsWorld[0]);
    leftBorderInnerPlane.setFromCoplanarPoints(
      leftCutPlanePointsWorld[2], leftCutPlanePointsWorld[1], leftCutPlanePointsWorld[0]);
  },

  returnToPool: function (force) {
    if (!this.backToPool && !force) { return; }
    
    this.el.sceneEl.components[this.poolName].returnEntity(this.el);
  },

  checkBigCollider: function (collider, hand, saberControls) {
    const saberColors = this.saberColors;

    if (!saberControls.hitboxGood || !saberControls.boundingBox.intersectsBox(collider)) {
      return false;
    }

    return this.data.color === saberColors[hand] && this.replayNote && this.replayNote.score > 0;
  },

  checkCollisions: function () {
    // const cutDirection = this.data.cutDirection;
    const saberEls = this.saberEls;
    
    this.beatBigBoundingBox.copy(this.hitboxObject.geometry.boundingBox).applyMatrix4(this.hitboxObject.matrixWorld);
    const beatBigBoundingBox = this.beatBigBoundingBox;

    if (this.smallHitObject) {
      this.beatBoundingBox.copy(this.smallHitObject.geometry.boundingBox).applyMatrix4(this.smallHitObject.matrixWorld);
    }
    
    const beatSmallBoundingBox = this.smallHitObject ? this.beatBoundingBox : this.beatBigBoundingBox;
    
    // const position = this.el.object3D.position;

    for (let i = 0; i < saberEls.length; i++) {
      let saberControls = saberEls[i].components['saber-controls'];
      let saberBoundingBox = saberControls.boundingBox;
      // let maxAngle;

      if (!saberBoundingBox) { break; }

      const hand = saberControls.data.hand;

      if ((saberControls.hitboxGood && saberBoundingBox.intersectsBox(beatSmallBoundingBox) && this.replayNote && this.replayNote.score != -3) || this.checkBigCollider(beatBigBoundingBox, hand, saberControls)) {
        // Sound.

        if (this.settings.realHitsounds) {
          this.el.parentNode.components['beat-hit-sound'].playSound(this.el, this.data.cutDirection);
        }

        if (this.data.type === 'mine') {
          if (this.replayNote) {
            this.postScoreEvent();
          }
          
          this.destroyMine();
          
          break;
        }

        this.postScoreEvent();
        this.destroyBeat(saberEls[i]);
        
        this.hitSaberEl = saberEls[i];
        if (this.settings.settings.reducedDebris) {
          this.onEndStroke();
        } else {
          this.hitSaberEl.addEventListener('strokeend', this.onEndStroke, ONCE);
        }
        
        // this.hitHand = hand;

        // saberControls.maxAnglePlaneX = 0;
        // saberControls.maxAnglePlaneY = 0;
        // saberControls.maxAnglePlaneXY = 0;

        // if (this.data.type === 'arrow') {
        //   saberControls.updateStrokeDirection();

          // if (cutDirection === 'up' || cutDirection === 'down') {
          //   maxAngle = saberControls.maxAnglePlaneX;
          // } else if (cutDirection === 'left' || cutDirection === 'right') {
          // maxAngle = saberControls.maxAnglePlaneY;
          // } else {
          //   maxAngle = saberControls.maxAnglePlaneXY;
          // }
        // } else {
        //   maxAngle = Math.max(saberControls.maxAnglePlaneX, saberControls.maxAnglePlaneY,
        //                       saberControls.maxAnglePlaneXY);
        // }
        // this.angleBeforeHit = maxAngle;
        break;
      }
    }
  },

  onEndStroke: function () {
    // var cutDirection = this.data.cutDirection;
    // var hitEventDetail = this.hitEventDetail;
    // var maxAngle;
    // var saberControls = this.hitSaberEl.components['saber-controls'];
    // var scoreText;

    // // Harcoded temporarily.
    // const saberRotation = 3.14 / 12;

    // if (cutDirection === 'up' || cutDirection === 'down') {
    //   maxAngle = saberControls.maxAnglePlaneX;
    // } else if (cutDirection === 'left' || cutDirection === 'right') {
    //   maxAngle = saberControls.maxAnglePlaneY;
    // } else {
    //   maxAngle = saberControls.maxAnglePlaneXY;
    // }

    // const angleBeforeHit = Math.max(0, (this.angleBeforeHit - saberRotation) * 180 / Math.PI);
    // const angleAfterHit = Math.max(0, (maxAngle - saberRotation) * 180 / Math.PI);

    // let score = 0;
    // score += angleBeforeHit >= 85 ? 70 : (angleBeforeHit / 80) * 70;
    // score += angleAfterHit >= 60 ? 30 : (angleAfterHit / 60) * 30;

    // hitEventDetail.score = score;
    this.el.sceneEl.emit('textglowbold', null, false);

    // let beatScorePool;
    // if (score < 60) { beatScorePool = SCORE_POOL.OK; }
    // else if (score < 80) { beatScorePool = SCORE_POOL.GOOD; }
    // else if (score < 100) { beatScorePool = SCORE_POOL.GREAT; }
    // else {
    //   beatScorePool = SCORE_POOL.SUPER;

      // this.superCuts[this.superCutIdx].components.supercutfx.createSuperCut(this.el.object3D.position);
      // this.superCutIdx = (this.superCutIdx + 1) % this.superCuts.length;
    // }

    this.showScore();
  },

  showScore: function (hand) {
    if (this.replayLoader.replays.length > 1) return;

    let score = this.replayNote.score;
    if (score < 0) {
      if (score == -3) {
        var missEl = hand === 'left' ? this.missElLeft : this.missElRight;
        if (!missEl) { return; }
        missEl.object3D.position.copy(this.el.object3D.position);
        missEl.object3D.position.y += 0.2;
        missEl.object3D.position.z -= 0.5;
        missEl.object3D.visible = true;
        missEl.emit('beatmiss', null, true);
      } else if (score == -2) {
        var wrongEl = hand === 'left' ? this.wrongElLeft : this.wrongElRight;
        if (!wrongEl) { return; }
        wrongEl.object3D.position.copy(this.el.object3D.position);
        wrongEl.object3D.position.y += 0.2;
        wrongEl.object3D.position.z -= 0.5;
        wrongEl.object3D.visible = true;
        wrongEl.emit('beatwrong', null, true);
      }
      
    } else {
      const scoreEl = this.el.sceneEl.components["pool__beatscoreok"].requestEntity();
      const colorAndScale = this.colorAndScaleForScore(score);
      scoreEl.setAttribute('text', 'value', "" + score);

      let duration = 500 / this.song.speed;
      if (this.settings.settings.colorScores) {
        scoreEl.setAttribute('text', 'color', colorAndScale.color);
        scoreEl.setAttribute('text', 'wrapCount', 33 - colorAndScale.scale * 15);
        scoreEl.setAttribute('animation__motionz', 'dur', duration * 3);
        scoreEl.setAttribute('animation__motionz', 'easing', 'linear');
      } else {
        scoreEl.setAttribute('text', 'color', "#fff");
        scoreEl.setAttribute('text', 'wrapCount', 18);
        scoreEl.setAttribute('animation__motionz', 'dur', duration);
        scoreEl.setAttribute('animation__motionz', 'easing', 'easeOutQuart');
      }
      
      scoreEl.setAttribute('animation__opacityin', 'dur', duration);
      scoreEl.setAttribute('animation__opacityout', 'dur', duration);
      
      scoreEl.setAttribute('animation__motiony', 'dur', duration);

      let random = Math.random() / 4;
      scoreEl.setAttribute('animation__motionz', 'to', -8 - random);
      scoreEl.setAttribute('animation__motiony', 'to', -1 + this.el.object3D.position.y / 3);
      scoreEl.object3D.position.copy(this.el.object3D.position);
      scoreEl.object3D.position.x += 0.6; // One block right
      scoreEl.object3D.position.z -= 3;
      scoreEl.play();
      scoreEl.emit('beatscorestart', null, false);

      // if (score == 115 && !this.settings.settings.noEffects) {
      //   this.superCuts[this.superCutIdx].components.supercutfx.createSuperCut(this.el.object3D.position);
      //   this.superCutIdx = (this.superCutIdx + 1) % this.superCuts.length;
      // }
    }
  },

  colorAndScaleForScore: (function () {
    var color = new THREE.Color();
    var fadeColor = new THREE.Color();

    return function (score) {
      const judgments = HSVConfig["judgments"];
      let judgment;
      let fadeJudgment;
      for (var i = judgments.length - 1; i >= 0; i--) {
        if (judgments[i].threshold >= score) {
          judgment = judgments[i];
          fadeJudgment = judgments[i + 1];
          break;
        }
      }

      color.setRGB(judgment.color[0], judgment.color[1], judgment.color[2])
      fadeColor.setRGB(fadeJudgment.color[0], fadeJudgment.color[1], fadeJudgment.color[2]);

      const resultColor = fadeColor.lerp(color, (score - fadeJudgment.threshold) / (judgment.threshold - fadeJudgment.threshold));
      const resultScale = (1.4 - (115 - score) / 115);

      return {color: "#" + resultColor.getHexString(), scale: Math.max(0.7, resultScale)};
    }
  })(),

  checkStaticHitsound: function () {
    if (this.data.type === 'mine' || this.hitSoundState == SOUND_STATE.hitPlayed) return;

    const currentTime = this.song.getCurrentTime();
    const noteTime = this.data.time - SWORD_OFFSET / this.data.speed;

    if (currentTime > noteTime) {
      this.el.parentNode.components['beat-hit-sound'].playSound(this.el, this.data.cutDirection);
      if (this.hitSoundState == SOUND_STATE.waitingForHitSound) {
        this.returnToPool(true);
      }
      this.hitSoundState = SOUND_STATE.hitPlayed;
    }
  },

  tockDestroyed: (function () {
    var leftCutNormal = new THREE.Vector3();
    var leftRotation = 0;
    var rightCutNormal = new THREE.Vector3();
    var rightRotation = 0;
    var rotationStep = 2 * Math.PI / 150 / 3;
    var fragment;

    return function (timeDelta) {
      // Update gravity velocity.
      this.gravityVelocity = getGravityVelocity(this.gravityVelocity, timeDelta);
      this.el.object3D.position.y += this.gravityVelocity * (timeDelta / 1000) * this.song.speed;

      if (this.data.type == 'mine') {
        for (var i = 0; i < this.mineFragments.length; i++) {
          fragment = this.mineFragments[i];
          if (!fragment.visible) { continue; }
          fragment.position.addScaledVector(fragment.speed, (timeDelta / 1000) * this.song.speed);
          fragment.scale.multiplyScalar(1 - 0.03 * this.song.speed);
          
          if (fragment.scale.y < 0.1 || this.el.object3D.position.y < -1){
            fragment.visible = false;
            this.backToPool = true;
          }
        }
        return;
      }

      rightCutNormal.copy(this.rightCutPlane.normal)
                    .multiplyScalar(DESTROYED_SPEED * (timeDelta / 500) * this.song.speed);
      rightCutNormal.y = 0;  // Y handled by gravity.
      this.partRightEl.object3D.position.add(rightCutNormal);
      this.partRightEl.object3D.setRotationFromAxisAngle(this.rotationAxis, rightRotation);
      rightRotation = rightRotation >= 2 * Math.PI ? 0 : rightRotation + rotationStep * this.song.speed;

      leftCutNormal.copy(this.leftCutPlane.normal)
                   .multiplyScalar(DESTROYED_SPEED * (timeDelta / 500) * this.song.speed);
      leftCutNormal.y = 0;  // Y handled by gravity.
      this.partLeftEl.object3D.position.add(leftCutNormal);
      this.partLeftEl.object3D.setRotationFromAxisAngle(this.rotationAxis, leftRotation);
      leftRotation = leftRotation >= 2 * Math.PI ? 0 : leftRotation + rotationStep * this.song.speed;

      this.generateCutClippingPlanes();

      this.returnToPoolTimer -= timeDelta * this.song.speed;
      this.backToPool = this.returnToPoolTimer <= 0 || this.el.object3D.position.y < -1;
    };
  })(),

  /**
   * Load OBJ from already parsed and loaded OBJ template.
   */
  setObjModelFromTemplate: (function () {
    const geometries = {};

    return function (el, templateId, material) {
      if (!geometries[templateId]) {
        const templateEl = document.getElementById(templateId);
        if (templateEl.getObject3D('mesh')) {
          geometries[templateId] = templateEl.getObject3D('mesh').children[0].geometry;
        } else {
          templateEl.addEventListener('model-loaded', () => {
            geometries[templateId] = templateEl.getObject3D('mesh').children[0].geometry;
            this.setObjModelFromTemplate(el, templateId, material);
          });
          return;
        }
      }

      if (!el.getObject3D('mesh')) { el.setObject3D('mesh', new THREE.Mesh()); }
      el.getObject3D('mesh').geometry = geometries[templateId];
      if (material) {
        el.getObject3D('mesh').material = material;
      }
    };
  })()
});

/**
 * Get velocity given current velocity using gravity acceleration.
 */
function getGravityVelocity (velocity, timeDelta) {
  const GRAVITY = -9.8;
  return velocity + (GRAVITY * (timeDelta / 1000));
}

const HSVConfig = {
  "judgments": [
    {
      "threshold": 115,
      "text": "<size=115%>%s</size>%n%n%B %C %A",
      "color": [
        1.0,
        1.0,
        1.0,
        1.0
      ],
      "fade": false
    },
    {
      "threshold": 113,
      "text": "<size=115%>%s</size>%n%n%B %C %A",
      "color": [
        0.5,
        0.0,
        0.85,
        1.0
      ],
      "fade": false
    },

    {
      "threshold": 110,
      "text": "<size=115%>%s</size>%n%n%B %C %A",
      "color": [
        0.0,
        1.0,
        1.0,
        1.0
      ],
      "fade": false
    },
    {
      "threshold": 105,
      "text": "<size=115%>%s</size>%n%n%B %C %A",
      "color": [
        0.0,
        1.0,
        0.0,
        1.0
      ],
      "fade": false
    },
    {
      "threshold": 100,
      "text": "<size=115%>%s</size>%n%n%B %C %A",
      "color": [
        1.0,
        0.980392158,
        0.0,
        1.0
      ],
      "fade": false
    },
    {
      "threshold": 70,
      "text": "<size=115%>%s</size>%n%n%B %C %A",
      "color": [
        1.0,
        0.6,
        0.0,
        1.0
      ],
      "fade": false
    },
    {
      "threshold": 50,
      "text": "<size=115%>%s</size>%n%n%B %C %A",
      "color": [
        1.0,
        0.0,
        0.0,
        1.0
      ],
      "fade": false
    },
    {
      "threshold": 0,
      "text": "<size=115%>%s</size>%n%n%B %C %A",
      "color": [
        0.3,
        0.0,
        0.0,
        1.0
      ],
      "fade": false
    }
  ],
}
