import { Container, Sprite } from 'pixi.js';
import evolutionsData from '../data/evolutions.json';
import weaponsData from '../data/weapons.json';
import type { DroneLevel } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const LEVELS: DroneLevel[] = weaponsData.drone.levels;
const TWIN_STATS: DroneLevel = evolutionsData.twindrone.stats;

/** 機体の浮遊距離と旋回速度（演出値） */
const HOVER_DIST = 70;
const HOVER_ROT_RAD = 1.2;
/** 機体位置の追従率（1秒あたり）。指数補間でふわっと付いてくる */
const FOLLOW_RATE = 8;

/**
 * ドローン: 自機の周囲に浮遊する子機が最寄りの敵へ自動射撃する召喚型（§8 Phase 8）。
 * 機体は常設スプライト（Container 枠）で、弾は通常の弾判定に乗る。
 * 進化（ツインドローン）は2機化 + 高レート（§10）。
 */
export class Drone extends WeaponBase {
  readonly id: string;
  override readonly evolved: boolean;
  override readonly sprite: Container;

  private readonly bodies: Sprite[] = [];
  private readonly bodyX: number[] = [];
  private readonly bodyY: number[] = [];
  private cooldown = 0;
  private hoverAngle = 0;
  private fireIndex = 0;

  constructor(
    private readonly textures: WeaponTextures,
    private readonly twin = false,
  ) {
    super();
    this.id = twin ? 'twindrone' : 'drone';
    this.evolved = twin;
    this.sprite = new Container();
    const bodyCount = twin ? TWIN_STATS.count : 1;
    for (let i = 0; i < bodyCount; i++) {
      const body = new Sprite(textures.droneBody);
      body.anchor.set(0.5);
      this.sprite.addChild(body);
      this.bodies.push(body);
      this.bodyX.push(0);
      this.bodyY.push(0);
    }
  }

  private def(): DroneLevel {
    return this.twin ? TWIN_STATS : LEVELS[this.level - 1];
  }

  update(dtSec: number, ctx: WeaponContext): void {
    const def = this.def();
    this.hoverAngle += HOVER_ROT_RAD * dtSec;

    // 機体の追従（指数補間）。複数機は等間隔の位相で回る
    const t = Math.min(1, FOLLOW_RATE * dtSec);
    for (let i = 0; i < this.bodies.length; i++) {
      const a = this.hoverAngle + (i * Math.PI * 2) / this.bodies.length;
      const tx = ctx.player.x + Math.cos(a) * HOVER_DIST;
      const ty = ctx.player.y + Math.sin(a) * HOVER_DIST - 24;
      this.bodyX[i] += (tx - this.bodyX[i]) * t;
      this.bodyY[i] += (ty - this.bodyY[i]) * t;
      this.bodies[i].position.set(this.bodyX[i], this.bodyY[i]);
    }

    this.cooldown -= dtSec;
    if (this.cooldown > 0) return;

    // 射撃は機体を交代しながら行う（ツインでは左右から交互に飛ぶ）
    const from = this.fireIndex % this.bodies.length;
    this.fireIndex++;
    const fx = this.bodyX[from];
    const fy = this.bodyY[from];
    const target = ctx.hash.nearestEnemy(fx, fy, ctx.searchRadius);
    if (target === null) return;
    this.cooldown = def.cooldownSec * ctx.cooldownMul;

    const baseAngle = Math.atan2(target.y - fy, target.x - fx);
    for (let k = 0; k < def.count; k++) {
      const p = ctx.spawnProjectile();
      if (p === null) return;
      const angle = baseAngle + (k - (def.count - 1) / 2) * 0.12;
      p.reset(this.textures.shot, fx, fy, Math.cos(angle) * def.speed, Math.sin(angle) * def.speed);
      p.radius = def.radius;
      p.damage = def.damage * ctx.damageMul;
      p.pierceLeft = 1;
      p.lifeSec = def.lifeSec;
    }
  }
}
