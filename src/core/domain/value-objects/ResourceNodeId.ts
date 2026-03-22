import { v4 as uuidv4 } from 'uuid';

export class ResourceNodeId {
  constructor(public readonly value: string) {}

  static generate(): ResourceNodeId {
    return new ResourceNodeId(uuidv4());
  }
}
