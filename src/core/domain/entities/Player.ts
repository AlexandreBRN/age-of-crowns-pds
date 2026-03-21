import { PlayerId } from '../value-objects/PlayerId';
import { Position } from '../value-objects/Position';

export class Player {
  private _position: Position;

  constructor(
    private readonly _id: PlayerId,
    private readonly _name: string,
    initialPosition: Position,
  ) {
    this._position = initialPosition;
  }

  get id(): PlayerId {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get position(): Position {
    return this._position;
  }

  moveTo(newPosition: Position): void {
    this._position = newPosition;
  }

  toJSON() {
    return {
      id: this._id.value,
      name: this._name,
      position: this._position.toJSON(),
    };
  }
}
