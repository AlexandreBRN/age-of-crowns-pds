import { ResourceNodeId } from '../value-objects/ResourceNodeId';

export type ResourceType = 'gold' | 'stone' | 'wood' | 'food_deer' | 'food_berry';

export const RESOURCE_YIELD: Record<ResourceType, number> = {
  gold: 10,
  stone: 8,
  wood: 12,
  food_deer: 15,
  food_berry: 10,
};

export const RESOURCE_KIND: Record<ResourceType, 'gold' | 'stone' | 'wood' | 'food'> = {
  gold: 'gold',
  stone: 'stone',
  wood: 'wood',
  food_deer: 'food',
  food_berry: 'food',
};

export const RESOURCE_INITIAL_AMOUNT: Record<ResourceType, number> = {
  gold: 600,
  stone: 500,
  wood: 400,
  food_deer: 300,
  food_berry: 250,
};

export class ResourceNode {
  private _remaining: number;

  constructor(
    private readonly _id: ResourceNodeId,
    private readonly _type: ResourceType,
    private readonly _x: number,
    private readonly _y: number,
    initialAmount?: number,
  ) {
    this._remaining = initialAmount ?? RESOURCE_INITIAL_AMOUNT[_type];
  }

  get id(): ResourceNodeId { return this._id; }
  get type(): ResourceType { return this._type; }
  get x(): number { return this._x; }
  get y(): number { return this._y; }
  get remaining(): number { return this._remaining; }
  get isDepleted(): boolean { return this._remaining <= 0; }

  get resourceKind(): 'gold' | 'stone' | 'wood' | 'food' {
    return RESOURCE_KIND[this._type];
  }

  harvest(amount: number): number {
    const actual = Math.min(amount, this._remaining);
    this._remaining -= actual;
    return actual;
  }

  toJSON() {
    return {
      id: this._id.value,
      type: this._type,
      position: { x: this._x, y: this._y },
      remaining: this._remaining,
    };
  }
}
