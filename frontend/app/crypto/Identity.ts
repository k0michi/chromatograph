import { Hex } from "./hex";

const ED25519: EcKeyAlgorithm | AlgorithmIdentifier = { name: "Ed25519" } as AlgorithmIdentifier;

export class Identity {
  private constructor(
    private readonly keyPair: CryptoKeyPair,
    readonly publicKeyBytes: Uint8Array<ArrayBuffer>,
  ) { }

  static async generate(): Promise<Identity> {
    const keyPair = (await crypto.subtle.generateKey(ED25519, true, ["sign", "verify"])) as CryptoKeyPair;
    const raw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    return new Identity(keyPair, new Uint8Array(raw));
  }

  static async fromJwk(privateKey: JsonWebKey, publicKey: JsonWebKey): Promise<Identity> {
    const [privateCryptoKey, publicCryptoKey] = await Promise.all([
      crypto.subtle.importKey("jwk", privateKey, ED25519, true, ["sign"]),
      crypto.subtle.importKey("jwk", publicKey, ED25519, true, ["verify"]),
    ]);
    const raw = await crypto.subtle.exportKey("raw", publicCryptoKey);
    const identity = new Identity(
      { privateKey: privateCryptoKey, publicKey: publicCryptoKey },
      new Uint8Array(raw),
    );
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    if (!await identity.verify(challenge, await identity.sign(challenge))) {
      throw new Error("The imported private and public keys do not match.");
    }
    return identity;
  }

  async exportJwk(): Promise<{ privateKey: JsonWebKey; publicKey: JsonWebKey }> {
    const [privateKey, publicKey] = await Promise.all([
      crypto.subtle.exportKey("jwk", this.keyPair.privateKey),
      crypto.subtle.exportKey("jwk", this.keyPair.publicKey),
    ]);
    return { privateKey, publicKey };
  }

  get publicKeyHex(): string {
    return Hex.fromBytes(this.publicKeyBytes);
  }

  async sign(data: Uint8Array<ArrayBufferLike>): Promise<Uint8Array<ArrayBuffer>> {
    const signature = await crypto.subtle.sign(ED25519, this.keyPair.privateKey, new Uint8Array(data));
    return new Uint8Array(signature);
  }

  async verify(data: Uint8Array<ArrayBufferLike>, signature: Uint8Array<ArrayBufferLike>): Promise<boolean> {
    return crypto.subtle.verify(ED25519, this.keyPair.publicKey, new Uint8Array(signature), new Uint8Array(data));
  }

  static async verify(
    publicKeyHex: string,
    data: Uint8Array<ArrayBufferLike>,
    signature: Uint8Array<ArrayBufferLike>,
  ): Promise<boolean> {
    const publicKey = await crypto.subtle.importKey("raw", Hex.toBytes(publicKeyHex), ED25519, false, ["verify"]);
    return crypto.subtle.verify(ED25519, publicKey, new Uint8Array(signature), new Uint8Array(data));
  }
}
