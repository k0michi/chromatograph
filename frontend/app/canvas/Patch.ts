import { Bytes } from "~/crypto/bytes";
import { Hex } from "~/crypto/hex";
import type { Identity } from "~/crypto/Identity";
import { Sha256 } from "~/crypto/sha256";
import type { Operation } from "./Operation";
import { OperationEncoder } from "./serializeOperations";

export class Patch {
  private constructor(
    readonly operations: readonly Operation[],
    readonly publicKeyHex: string,
    readonly hash: string,
    readonly signatureHex: string,
  ) { }

  static async create(operations: readonly Operation[], identity: Identity): Promise<Patch> {
    const operationBytes = OperationEncoder.operations(operations);
    const hashInput = Bytes.concat([operationBytes, identity.publicKeyBytes]);
    const hashBytes = await Sha256.digest(hashInput);
    const signatureBytes = await identity.sign(hashBytes);
    return new Patch(operations, identity.publicKeyHex, Hex.fromBytes(hashBytes), Hex.fromBytes(signatureBytes));
  }

  static fromEncoded(
    operations: readonly Operation[],
    publicKeyHex: string,
    hash: string,
    signatureHex: string,
  ): Patch {
    return new Patch(operations, publicKeyHex, hash, signatureHex);
  }
}
