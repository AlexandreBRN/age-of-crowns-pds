import { v4 as uuidv4 } from 'uuid';

export class VillagerId {
  constructor(public readonly value: string) {}

  static generate(): VillagerId {
    return new VillagerId(uuidv4());
  }

  equals(other: VillagerId): boolean {
    return this.value === other.value;
  }
}
