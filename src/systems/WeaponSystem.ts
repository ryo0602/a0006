import type { Container } from 'pixi.js';
import { Axe } from '../weapons/Axe';
import { Boomerang } from '../weapons/Boomerang';
import { Cluster } from '../weapons/Cluster';
import { Drone } from '../weapons/Drone';
import { Flame } from '../weapons/Flame';
import { Gatling } from '../weapons/Gatling';
import { Inferno } from '../weapons/Inferno';
import { Lance } from '../weapons/Lance';
import { Meteor } from '../weapons/Meteor';
import { Mine } from '../weapons/Mine';
import { Orb } from '../weapons/Orb';
import { Satellite } from '../weapons/Satellite';
import { Shot } from '../weapons/Shot';
import { Shuriken } from '../weapons/Shuriken';
import { Spear } from '../weapons/Spear';
import { Storm } from '../weapons/Storm';
import { Thunder } from '../weapons/Thunder';
import { WeaponBase, WeaponContext, WeaponTextures } from '../weapons/WeaponBase';

/** 武器の所持上限（§13。初期武器を含む合計） */
export const MAX_WEAPONS = 6;

export const WEAPON_IDS = [
  'shot',
  'orb',
  'shuriken',
  'thunder',
  'flame',
  'spear',
  'axe',
  'mine',
  'drone',
] as const;

/**
 * 所持武器の管理と毎フレームの update 呼び出し（§4.2 の 6）。
 * 武器が常設スプライトを持つ場合はここでワールドに載せる。
 */
export class WeaponSystem {
  private readonly weapons: WeaponBase[] = [];

  constructor(
    private readonly world: Container,
    private readonly textures: WeaponTextures,
  ) {}

  get list(): readonly WeaponBase[] {
    return this.weapons;
  }

  get count(): number {
    return this.weapons.length;
  }

  has(id: string): boolean {
    return this.weapons.some((w) => w.id === id);
  }

  find(id: string): WeaponBase | null {
    return this.weapons.find((w) => w.id === id) ?? null;
  }

  add(id: string): void {
    if (this.weapons.length >= MAX_WEAPONS || this.has(id)) return;
    const w = createWeapon(id, this.textures);
    this.weapons.push(w);
    if (w.sprite !== null) this.world.addChild(w.sprite);
  }

  update(dtSec: number, ctx: WeaponContext): void {
    for (let i = 0; i < this.weapons.length; i++) {
      this.weapons[i].update(dtSec, ctx);
    }
  }

  /**
   * 進化（§10）。元武器を同じ枠で進化武器に置き換える（所持数は増えない）。
   * 元武器が借りているリソース（オーブの周回弾など）は dispose で返す。
   */
  replace(baseId: string, evolvedId: string): void {
    const index = this.weapons.findIndex((w) => w.id === baseId);
    if (index < 0) return;
    const old = this.weapons[index];
    old.dispose();
    if (old.sprite !== null) this.world.removeChild(old.sprite);
    const next = createWeapon(evolvedId, this.textures);
    this.weapons[index] = next;
    if (next.sprite !== null) this.world.addChild(next.sprite);
  }

  /** リトライ時に全撤去する。借りている弾の返却は dispose → PlayScene のスイープが担う */
  reset(): void {
    for (let i = 0; i < this.weapons.length; i++) {
      this.weapons[i].dispose();
      const s = this.weapons[i].sprite;
      if (s !== null) this.world.removeChild(s);
    }
    this.weapons.length = 0;
  }
}

function createWeapon(id: string, textures: WeaponTextures): WeaponBase {
  switch (id) {
    case 'shot':
      return new Shot(textures);
    case 'orb':
      return new Orb(textures);
    case 'shuriken':
      return new Shuriken(textures);
    case 'thunder':
      return new Thunder(textures);
    case 'flame':
      return new Flame(textures);
    case 'gatling':
      return new Gatling(textures);
    case 'satellite':
      return new Satellite(textures);
    case 'boomerang':
      return new Boomerang(textures);
    case 'storm':
      return new Storm(textures);
    case 'inferno':
      return new Inferno(textures);
    case 'spear':
      return new Spear(textures);
    case 'axe':
      return new Axe(textures);
    case 'mine':
      return new Mine(textures);
    case 'drone':
      return new Drone(textures);
    case 'lance':
      return new Lance(textures);
    case 'meteor':
      return new Meteor(textures);
    case 'cluster':
      return new Cluster(textures);
    case 'twindrone':
      return new Drone(textures, true);
    default:
      throw new Error(`未知の武器ID: ${id}`);
  }
}
