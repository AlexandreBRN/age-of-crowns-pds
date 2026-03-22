export interface ResourceValues {
  gold: number;
  wood: number;
  stone: number;
  food: number;
}

export class Resources {
  constructor(
    public readonly gold: number,
    public readonly wood: number,
    public readonly stone: number,
    public readonly food: number,
  ) {}

  static zero(): Resources {
    return new Resources(0, 0, 0, 0);
  }

  static initial(): Resources {
    return new Resources(200, 200, 0, 100);
  }

  add(other: Partial<ResourceValues>): Resources {
    return new Resources(
      this.gold + (other.gold ?? 0),
      this.wood + (other.wood ?? 0),
      this.stone + (other.stone ?? 0),
      this.food + (other.food ?? 0),
    );
  }

  subtract(other: Partial<ResourceValues>): Resources {
    const gold = this.gold - (other.gold ?? 0);
    const wood = this.wood - (other.wood ?? 0);
    const stone = this.stone - (other.stone ?? 0);
    const food = this.food - (other.food ?? 0);

    if (gold < 0 || wood < 0 || stone < 0 || food < 0) {
      throw new Error('Recursos insuficientes');
    }

    return new Resources(gold, wood, stone, food);
  }

  canAfford(cost: Partial<ResourceValues>): boolean {
    return (
      this.gold >= (cost.gold ?? 0) &&
      this.wood >= (cost.wood ?? 0) &&
      this.stone >= (cost.stone ?? 0) &&
      this.food >= (cost.food ?? 0)
    );
  }

  toJSON(): ResourceValues {
    return { gold: this.gold, wood: this.wood, stone: this.stone, food: this.food };
  }
}
