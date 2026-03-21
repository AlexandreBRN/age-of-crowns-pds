import { v4 as uuidv4 } from 'uuid';

export class PlayerId {
  constructor(public readonly value: string) {}

  static generate(): PlayerId {
    return new PlayerId(uuidv4());
  }

  equals(other: PlayerId): boolean {
    return this.value === other.value;
  }
}
